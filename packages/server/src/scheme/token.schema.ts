import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
export type TokenDocument = Token & Document;

@Schema()
export class Token extends Document {
  @Prop({ index: true })
  userId: number;

  // Legacy records may still contain a raw token. New writes use tokenHash,
  // and both fields are excluded from normal query results.
  @Prop({ index: true, select: false })
  token?: string;

  @Prop({ index: true, sparse: true, select: false })
  tokenHash?: string;

  @Prop({ index: true, trim: true, maxlength: 64 })
  name?: string;

  @Prop()
  expiresIn: number;

  @Prop({ index: true })
  expiresAt?: Date;

  @Prop({
    index: true,
    default: () => {
      return new Date();
    },
  })
  createdAt: Date;

  @Prop({ default: false, index: true })
  disabled: boolean;
}

export const TokenSchema = SchemaFactory.createForClass(Token);

const omitTokenSecrets = (_document: unknown, value: Record<string, any>) => {
  delete value.token;
  delete value.tokenHash;
  return value;
};

TokenSchema.set('toJSON', { transform: omitTokenSecrets });
TokenSchema.set('toObject', { transform: omitTokenSecrets });
