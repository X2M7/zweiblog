import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type RateLimitDocument = RateLimit & Document;

@Schema({ collection: 'rateLimits', versionKey: false })
export class RateLimit extends Document {
  @Prop({ required: true })
  keyHash: string;

  @Prop({ required: true })
  bucket: number;

  @Prop({ required: true, default: 0 })
  count: number;

  @Prop({ required: true, expires: 0 })
  expiresAt: Date;
}

export const RateLimitSchema = SchemaFactory.createForClass(RateLimit);
RateLimitSchema.index({ keyHash: 1, bucket: 1 }, { unique: true });
