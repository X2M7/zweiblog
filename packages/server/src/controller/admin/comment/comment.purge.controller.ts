import {
  BadRequestException,
  Controller,
  Delete,
  NotFoundException,
  Optional,
  Param,
  UseGuards,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ApiTags } from '@nestjs/swagger';
import { Model, Types } from 'mongoose';
import { config } from 'src/config';
import { AdminGuard } from 'src/provider/auth/auth.guard';
import { Comment, CommentDocument } from 'src/scheme/comment.schema';
import { CommentReaction, CommentReactionDocument } from 'src/scheme/commentReaction.schema';
import {
  CommentMigrationTombstone,
  CommentMigrationTombstoneDocument,
} from 'src/scheme/commentMigrationTombstone.schema';
import { ApiToken } from 'src/provider/swagger/token';
import { normalizeCommentId } from 'src/utils/comment';
import { CommentMaintenanceProvider } from 'src/provider/comment/commentMaintenance.provider';

/**
 * Destructive comment cleanup is intentionally kept separate from the normal
 * moderation controller. A comment must first be soft-deleted in the admin UI.
 */
@ApiTags('comment-admin')
@ApiToken
@UseGuards(...AdminGuard)
@Controller('/api/admin/comment')
export class AdminCommentPurgeController {
  constructor(
    @InjectModel(Comment.name) private readonly commentModel: Model<CommentDocument>,
    @InjectModel(CommentMigrationTombstone.name)
    private readonly tombstoneModel: Model<CommentMigrationTombstoneDocument>,
    private readonly commentMaintenanceProvider: CommentMaintenanceProvider,
    @Optional()
    @InjectModel(CommentReaction.name)
    private readonly reactionModel?: Model<CommentReactionDocument>,
  ) {}

  private assertWritable() {
    if (config.demo === true || config.demo === 'true') {
      throw new BadRequestException('演示站禁止永久清除评论');
    }
  }

  @Delete('/:id/permanent')
  async purge(@Param('id') idValue: string) {
    return this.commentMaintenanceProvider.withExclusive('comment-permanent-delete', () =>
      this.purgeUnlocked(idValue),
    );
  }

  private async purgeUnlocked(idValue: string) {
    this.assertWritable();
    const id = normalizeCommentId(idValue, true) as string;
    const objectId = new Types.ObjectId(id);
    const existing = await this.commentModel.findById(objectId).select('+legacyId').lean().exec();
    if (!existing) throw new NotFoundException('Comment not found');
    if (existing.status !== 'deleted') {
      throw new BadRequestException('Soft-delete the comment before permanently clearing it');
    }
    await this.reactionModel?.deleteMany({ commentId: objectId }).exec();

    const descendants = await this.commentModel
      .countDocuments({
        $or: [{ parentId: objectId }, { rootId: objectId }],
      })
      .maxTimeMS(2_000)
      .exec();

    if (descendants > 0) {
      await this.commentModel
        .updateOne(
          { _id: objectId, status: 'deleted' },
          {
            $set: {
              content: '[deleted]',
              nick: 'Anonymous',
              mail: '',
              link: '',
              likes: 0,
              isAdmin: false,
              ip: '',
              ua: '',
              location: '',
              browser: '',
              os: '',
            },
            // Keep legacyId as a migration tombstone. Removing it would let a
            // later idempotent Waline migration restore the deleted content.
            $unset: { duplicateKeys: 1 },
          },
        )
        .exec();
      return {
        statusCode: 200,
        data: {
          id,
          purged: true,
          placeholder: true,
          removed: false,
          descendantsPreserved: descendants,
        },
      };
    }

    if (existing.legacyId) {
      // Write the no-PII tombstone first. If this fails, retain the already
      // scrubbed comment and fail closed rather than allowing a later Waline
      // migration to resurrect its content and email.
      await this.tombstoneModel
        .updateOne(
          { legacyId: existing.legacyId },
          { $setOnInsert: { legacyId: existing.legacyId } },
          { upsert: true },
        )
        .exec();
    }
    const removed = await this.commentModel.deleteOne({ _id: objectId, status: 'deleted' }).exec();
    if (removed.deletedCount !== 1) throw new NotFoundException('Comment not found');
    return {
      statusCode: 200,
      data: {
        id,
        purged: true,
        placeholder: false,
        removed: true,
        descendantsPreserved: 0,
      },
    };
  }
}
