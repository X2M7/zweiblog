import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { CommentStatus } from 'src/types/comment.dto';

export type CommentDocument = Comment & Document;

@Schema({ collection: 'comments', timestamps: true, versionKey: false })
export class Comment {
  _id: Types.ObjectId;

  @Prop({ required: true, index: true, maxlength: 512 })
  path: string;

  /** Stable article association so changing a slug does not orphan comments. */
  @Prop({ index: true, min: 0 })
  articleId?: number;

  /** Legacy post paths that could not be bound to one stable article. */
  @Prop({ default: false, index: true })
  quarantined?: boolean;

  @Prop({ required: true, maxlength: 50_000 })
  content: string;

  @Prop({ required: true, maxlength: 80 })
  nick: string;

  @Prop({ default: '', maxlength: 254, select: false })
  mail: string;

  @Prop({ default: '', maxlength: 500 })
  link: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: Comment.name, default: null, index: true })
  parentId: Types.ObjectId | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: Comment.name, default: null, index: true })
  rootId: Types.ObjectId | null;

  /** Atomic, reusable capacity slot within a root thread. */
  @Prop({ min: 1, max: 100 })
  threadPosition?: number;

  @Prop({
    required: true,
    default: 'pending',
    enum: ['approved', 'pending', 'spam', 'deleted'],
    index: true,
  })
  status: CommentStatus;

  @Prop({ default: 0, min: 0 })
  likes: number;

  @Prop({ default: false })
  isAdmin: boolean;

  /** Raw network/client identifiers are private and only selected by admin queries. */
  @Prop({ default: '', maxlength: 128, select: false })
  ip?: string;

  @Prop({ default: '', maxlength: 512, select: false })
  ua?: string;

  /** Coarse, locally-derived metadata is safe to display beside a public comment. */
  @Prop({ default: '未知地区', maxlength: 160 })
  location?: string;

  @Prop({ default: '未知浏览器', maxlength: 128 })
  browser?: string;

  @Prop({ default: '未知系统', maxlength: 128 })
  os?: string;

  @Prop({ index: true, unique: true, sparse: true, select: false, maxlength: 512 })
  legacyId?: string;

  /**
   * Two overlapping time-bucket hashes make duplicate submission rejection
   * atomic, including requests racing on opposite sides of a bucket boundary.
   */
  @Prop({ type: [String], select: false })
  duplicateKeys?: string[];

  createdAt: Date;
  updatedAt: Date;
}

export const CommentSchema = SchemaFactory.createForClass(Comment);

CommentSchema.index({ path: 1, status: 1, parentId: 1, createdAt: -1 });
CommentSchema.index({ path: 1, status: 1, rootId: 1, createdAt: 1 });
CommentSchema.index({ articleId: 1, status: 1, parentId: 1, createdAt: -1 });
CommentSchema.index({ duplicateKeys: 1 }, { unique: true, sparse: true });
CommentSchema.index(
  { rootId: 1, threadPosition: 1 },
  {
    unique: true,
    partialFilterExpression: {
      rootId: { $type: 'objectId' },
      threadPosition: { $type: 'number' },
    },
  },
);
