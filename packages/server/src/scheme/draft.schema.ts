import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { ARTICLE_SUMMARY_MAX_LENGTH } from 'src/utils/localizedArticleFields';

export type DraftDocument = Draft & Document;

@Schema()
export class Draft extends Document {
  @Prop({ index: true, unique: true })
  id: number;

  @Prop({ index: true })
  title: string;

  @Prop({ default: '', index: true })
  titleEn?: string;

  @Prop({ default: '' })
  content: string;

  @Prop({ default: '' })
  contentEn?: string;

  @Prop({ default: '', maxlength: ARTICLE_SUMMARY_MAX_LENGTH })
  summary?: string;

  @Prop({ default: '', maxlength: ARTICLE_SUMMARY_MAX_LENGTH })
  summaryEn?: string;

  @Prop({ default: [], index: true })
  tags: string[];

  @Prop({ index: true })
  author: string;

  @Prop({ index: true })
  category: string;

  @Prop({ default: false, index: true })
  deleted: boolean;

  @Prop({
    index: true,
    default: () => {
      return new Date();
    },
  })
  createdAt: Date;

  @Prop({
    index: true,
    default: () => {
      return new Date();
    },
  })
  updatedAt: Date;
}

export const DraftSchema = SchemaFactory.createForClass(Draft);
