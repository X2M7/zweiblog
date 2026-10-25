import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type VisitDocument = Visit & Document;

@Schema()
export class Visit extends Document {
  @Prop()
  aggregate?: boolean;

  @Prop()
  visited: number;

  @Prop()
  viewer: number;

  @Prop({ index: true })
  date: string;

  @Prop({ index: true })
  pathname: string;

  @Prop({ index: true })
  lastVisitedTime: Date;

  @Prop({
    index: true,
    default: () => {
      return new Date();
    },
  })
  createdAt: Date;
}

export const VisitSchema = SchemaFactory.createForClass(Visit);

VisitSchema.index(
  { pathname: 1 },
  { name: 'visit_aggregate_path', unique: true, partialFilterExpression: { aggregate: true } },
);
VisitSchema.index({ pathname: 1, aggregate: -1, date: -1 });
