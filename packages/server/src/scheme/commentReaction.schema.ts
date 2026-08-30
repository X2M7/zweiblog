import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { Comment } from './comment.schema';

export type CommentReactionDocument = CommentReaction & Document;

/**
 * A reaction belongs to an anonymous first-party browser identity. Only an
 * HMAC digest of the random cookie is retained, never the cookie or IP itself.
 */
@Schema({ collection: 'comment_reactions', timestamps: true, versionKey: false })
export class CommentReaction {
  _id: Types.ObjectId;

  @Prop({
    required: true,
    type: MongooseSchema.Types.ObjectId,
    ref: Comment.name,
    index: true,
  })
  commentId: Types.ObjectId;

  @Prop({ required: true, maxlength: 64, select: false })
  actorHash: string;

  createdAt: Date;
  updatedAt: Date;
}

export const CommentReactionSchema = SchemaFactory.createForClass(CommentReaction);
CommentReactionSchema.index({ commentId: 1, actorHash: 1 }, { unique: true });
