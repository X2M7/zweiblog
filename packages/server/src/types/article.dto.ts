import { SortOrder } from './sort';

export class CreateArticleDto {
  title: string;
  titleEn?: string;
  content?: string;
  contentEn?: string;
  summary?: string;
  summaryEn?: string;
  tags?: string[];
  top?: number;
  category: string;
  hidden?: boolean;
  private?: boolean;
  password?: string;
  updatedAt?: Date;
  createdAt?: Date;
  author?: string;
  copyright?: string;
  copyrightEn?: string;
  pathname?: string;
}
export class UpdateArticleDto {
  title?: string;
  titleEn?: string;
  content?: string;
  contentEn?: string;
  summary?: string;
  summaryEn?: string;
  tags?: string[];
  category?: string;
  hidden?: boolean;
  top?: number;
  private?: boolean;
  password?: string;
  deleted?: boolean;
  viewer?: number;
  visited?: number;
  updatedAt?: Date;
  createdAt?: Date;
  author?: string;
  copyright?: string;
  copyrightEn?: string;
  pathname?: string;
}
export class SearchArticleOption {
  page: number;
  pageSize: number;
  regMatch: boolean;
  category?: string;
  tags?: string;
  title?: string;
  sortCreatedAt?: SortOrder;
  sortTop?: SortOrder;
  startTime?: string;
  endTime?: string;
  sortViewer?: string;
  toListView?: boolean;
  withWordCount?: boolean;
  author?: string;
}
