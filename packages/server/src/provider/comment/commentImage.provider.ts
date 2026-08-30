import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { Model, Types } from 'mongoose';
import { Static, StaticDocument } from 'src/scheme/static.schema';
import { readSafeImageMetadata } from 'src/utils/imageMetadata';
import { LocalProvider } from '../static/local.provider';

/** Stores anonymous comment images locally even when the article image store uses PicGo. */
@Injectable()
export class CommentImageProvider {
  constructor(
    @InjectModel(Static.name) private readonly staticModel: Model<StaticDocument>,
    private readonly localProvider: LocalProvider,
  ) {}

  async saveNormalizedWebp(buffer: Buffer) {
    const metadata = readSafeImageMetadata(buffer);
    const sign = createHash('sha256').update(buffer).digest('hex');
    const name = `comment-${sign}.webp`;
    const saved = await this.localProvider.saveImg(name, buffer, 'img');
    // A deterministic id makes concurrent duplicate uploads idempotent while
    // still registering the file for local image management and backups.
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
  }
}
