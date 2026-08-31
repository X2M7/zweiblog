import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type TagDocument = Tag & Document;

@Schema()
export class Tag extends Document {
  @Prop({ index: true, unique: true })
  name: string;

  @Prop({ default: '' })
  nameEn?: string;
}

export const TagSchema = SchemaFactory.createForClass(Tag);
