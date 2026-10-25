import { Injectable, Logger, PayloadTooLargeException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Interval } from '@nestjs/schedule';
import { createHash } from 'crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Collection } from 'mongodb';
import { Connection, Model, Types } from 'mongoose';
import { config } from 'src/config';
import { Static, StaticDocument } from 'src/scheme/static.schema';
import { readSafeImageMetadata } from 'src/utils/imageMetadata';
import { LocalProvider } from '../static/local.provider';
import { CommentMaintenanceProvider } from './commentMaintenance.provider';
import type { ResolvedCommentTarget } from './comment.provider';

const MAX_COMMENT_IMAGE_BYTES = 512 * 1024 * 1024;
const MAX_COMMENT_IMAGE_FILES = 2000;
const UPLOAD_LIFETIME_MS = 24 * 60 * 60 * 1000;
const IMAGE_NAME = /^comment-[a-f0-9]{64}\.webp$/;
// Browsers may percent-encode any ASCII character in a valid local image URL.
// Decode only ASCII escapes so unrelated malformed Unicode escapes cannot
// prevent matching the attachment names elsewhere in the same document.
const imageReferenceText = (value: string) =>
  value.replace(/%([0-7][a-f0-9])/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
interface UploadRecord {
  _id: string;
  name: string;
  path: string;
  articleId?: number;
  bytes: number;
  linked: boolean;
  expiresAt: Date;
}

/** Anonymous images have a bounded local store and expire unless used in content. */
@Injectable()
export class CommentImageProvider {
  private readonly uploads: Collection<UploadRecord>;
  private readonly logger = new Logger(CommentImageProvider.name);
  constructor(
    @InjectModel(Static.name) private readonly staticModel: Model<StaticDocument>,
    private readonly localProvider: LocalProvider,
    @InjectConnection() private readonly connection: Connection,
    private readonly maintenance: CommentMaintenanceProvider,
  ) {
    this.uploads = connection.db.collection<UploadRecord>('comment_image_uploads');
  }

  async onModuleInit() {
    // Do not use a Mongo TTL index: deleting a record alone would orphan its file.
    await this.uploads.createIndex({ linked: 1, expiresAt: 1 });
  }

  async assertCapacity(extraBytes = 0, existingName?: string) {
    const directory = path.join(config.staticPath, 'img');
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    let bytes = extraBytes;
    let files = extraBytes ? 1 : 0;
    for (const entry of entries) {
      if (!IMAGE_NAME.test(entry.name) || entry.name === existingName) continue;
      const stat = await fs.lstat(path.join(directory, entry.name)).catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (!stat) continue;
      bytes += stat.size;
      files++;
      if (bytes >= MAX_COMMENT_IMAGE_BYTES || files >= MAX_COMMENT_IMAGE_FILES) {
        throw new PayloadTooLargeException('Comment image storage quota reached');
      }
    }
    if (bytes >= MAX_COMMENT_IMAGE_BYTES || files >= MAX_COMMENT_IMAGE_FILES) {
      throw new PayloadTooLargeException('Comment image storage quota reached');
    }
  }

  async saveNormalizedWebp(buffer: Buffer, target: ResolvedCommentTarget) {
    const metadata = readSafeImageMetadata(buffer);
    const sign = createHash('sha256').update(buffer).digest('hex');
    const name = `comment-${sign}.webp`;
    return this.maintenance.withExclusive('comment-image-upload', async (lease) => {
      await this.assertCapacity(buffer.byteLength, name);
      await lease.assertOwned();
      // An existing file can belong to content predating attachment tracking.
      // Never make a legacy image eligible for automatic deletion on reupload.
      const existing = await fs.lstat(path.join(config.staticPath, 'img', name)).catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      // Register before writing, so interrupted uploads can also be collected.
      await this.uploads.updateOne(
        { _id: sign },
        {
          $setOnInsert: {
            name,
            path: target.path,
            articleId: target.articleId,
            bytes: buffer.byteLength,
            linked: !!existing,
          },
          $set: { expiresAt: new Date(Date.now() + UPLOAD_LIFETIME_MS) },
        },
        { upsert: true },
      );
      const saved = await this.localProvider.saveImg(name, buffer, 'img');
      await this.staticModel
        .updateOne(
          { _id: new Types.ObjectId(sign.slice(0, 24)) },
          {
            $setOnInsert: {
              fileType: 'webp',
              staticType: 'img',
              storageType: 'local',
              sign,
              name,
              realPath: saved.realPath,
              meta: saved.meta || metadata,
            },
          },
          { upsert: true },
        )
        .exec();
      return { src: saved.realPath, sign, isNew: true };
    });
  }

  /** Called under the existing shared comment-write lease after a successful insert. */
  async linkFromContent(content: string) {
    const names = Array.from(
      new Set(imageReferenceText(content).match(/comment-[a-f0-9]{64}\.webp/g) || []),
    );
    if (names.length)
      await this.uploads.updateMany({ name: { $in: names } }, { $set: { linked: true } });
  }

  /** Pin images before an authenticated editor persists references to them. */
  async retainAdminReferences(body: unknown, multipart = false) {
    const names = Array.from(
      new Set(
        imageReferenceText(JSON.stringify(body ?? {}) || '').match(/comment-[a-f0-9]{64}\.webp/g) ||
          [],
      ),
    );
    if (!names.length && !multipart) return;
    await this.maintenance.withExclusive('comment-image-admin-retain', async (lease) => {
      await lease.assertOwned();
      // Retain matching tracked attachments only; never require arbitrary
      // filenames in prose or external image URLs to exist on this server.
      // Multipart HTML/backup contents are not available before their upload
      // interceptor. Conservatively retain pending images on authenticated
      // imports, instead of racing deletion against content being installed.
      await this.uploads.updateMany(multipart ? { linked: false } : { name: { $in: names } }, {
        $set: { linked: true },
      });
    });
  }

  async cleanupExpired() {
    return this.maintenance.withExclusive('comment-image-cleanup', async (lease) => {
      const expired = await this.uploads
        .find({ linked: false, expiresAt: { $lte: new Date() } })
        .limit(100)
        .toArray();
      for (const upload of expired) {
        if (!IMAGE_NAME.test(upload.name)) continue;
        // Also preserve images used by imported/admin content or a successful
        // insert whose attachment-marking step was interrupted.
        const pattern = Array.from(
          upload.name,
          (character) =>
            `(?:${character === '.' ? '\\.' : character}|%${character.charCodeAt(0).toString(16)})`,
        ).join('');
        let referenced = false;
        for (const collection of ['comments', 'articles', 'drafts', 'custompages']) {
          const reference = await this.connection.db.collection(collection).findOne(
            {
              $or: [
                'content',
                'contentEn',
                'summary',
                'summaryEn',
                'html',
                'copyright',
                'copyrightEn',
              ].map((field) => ({
                [field]: { $regex: pattern, $options: 'i' },
              })),
            },
            { projection: { _id: 1 }, maxTimeMS: 2000 },
          );
          if (reference) {
            referenced = true;
            break;
          }
        }
        if (!referenced) {
          const meta = await this.connection.db
            .collection('metas')
            .findOne({}, { maxTimeMS: 2000 });
          referenced = imageReferenceText(JSON.stringify(meta || {})).includes(upload.name);
        }
        await lease.assertOwned();
        if (referenced) {
          await this.uploads.updateOne({ _id: upload._id }, { $set: { linked: true } });
          continue;
        }
        await fs.unlink(path.join(config.staticPath, 'img', upload.name)).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        });
        await this.staticModel.deleteOne({ sign: upload._id, name: upload.name }).exec();
        await this.uploads.deleteOne({ _id: upload._id, linked: false });
      }
    });
  }

  @Interval(60 * 60 * 1000)
  async collectExpiredUploads() {
    try {
      await this.cleanupExpired();
    } catch {
      this.logger.warn('Comment image cleanup deferred; it will retry next hour');
    }
  }
}
