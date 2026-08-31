export interface Article {
  content: string;
  contentEn?: string;
  category: string;
  categoryEn?: string;
  tags: string[];
  tagsEn?: string[];
  createdAt: string;
  title: string;
  titleEn?: string;
  summary?: string;
  summaryEn?: string;
  hasEnglishVersion?: boolean;
  updatedAt: string;
  id: number;
  top?: number;
  private: boolean;
  author?: string;
  copyright?: string;
  copyrightEn?: string;
  pathname?: string;
}
