import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type CommentMigrationTombstoneDocument = CommentMigrationTombstone & Document;

/**
 * Records an explicit permanent deletion of a migrated comment without
 * retaining its content, email, profile link, IP or user-agent data.
 */
@Schema({ collection: 'commentMigrationTombstones', timestamps: true, versionKey: false })
export class CommentMigrationTombstone {
  _id: Types.ObjectId;

  @Prop({ required: true, unique: true, index: true, maxlength: 512 })
  legacyId: string;

  createdAt: Date;
  updatedAt: Date;
}

export const CommentMigrationTombstoneSchema = SchemaFactory.createForClass(
  CommentMigrationTombstone,
);
