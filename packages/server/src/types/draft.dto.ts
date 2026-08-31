import { SortOrder } from './sort';

export class CreateDraftDto {
  title: string;
  titleEn?: string;
  content?: string;
  contentEn?: string;
  summary?: string;
  summaryEn?: string;
  tags?: string[];
  category: string;
  author?: string;
  createdAt?: Date;
  updatedAt?: Date;
  draft?: string;
}
export class UpdateDraftDto {
  title?: string;
  titleEn?: string;
  content?: string;
  contentEn?: string;
  summary?: string;
  summaryEn?: string;
  tags?: string[];
  category?: string;
  deleted?: boolean;
  author?: string;
  createdAt?: Date;
  updatedAt?: Date;
  draft?: string;
}
export class PublishDraftDto {
  title?: string;
  titleEn?: string;
  content?: string;
  contentEn?: string;
  summary?: string;
  summaryEn?: string;
  top?: number;
  hidden?: boolean;
  pathname?: string;
  private?: boolean;
  password?: string;
  copyright?: string;
  copyrightEn?: string;
}
export class SearchDraftOption {
  page: number;
  pageSize: number;
  category?: string;
  tags?: string;
  title?: string;
  sortCreatedAt?: SortOrder;
  startTime?: string;
  endTime?: string;
  toListView?: boolean;
}
