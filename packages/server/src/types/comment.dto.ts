export const COMMENT_STATUSES = ['approved', 'pending', 'spam', 'deleted'] as const;

export type CommentStatus = (typeof COMMENT_STATUSES)[number];
export type ModeratableCommentStatus = Exclude<CommentStatus, 'deleted'>;

export interface CreateCommentDto {
  path?: unknown;
  url?: unknown;
  content?: unknown;
  comment?: unknown;
  nick?: unknown;
  mail?: unknown;
  link?: unknown;
  parentId?: unknown;
  replyToId?: unknown;
  /** Honeypot. Real clients must leave this empty. */
  website?: unknown;
}

export interface NormalizedCreateCommentDto {
  path: string;
  content: string;
  nick: string;
  mail: string;
  link: string;
  replyToId?: string;
}

export interface CommentRequestMetadata {
  ip?: unknown;
  ua?: unknown;
}

export interface PublicCommentDto {
  id: string;
  content: string;
  path: string;
  parentId: string | null;
  replyToId: string | null;
  replyToNick: string | null;
  likes: number;
  createdAt: Date;
  nick: string;
  link: string;
  isAdmin: boolean;
  location: string;
  browser: string;
  os: string;
  liked?: boolean;
  deleted?: boolean;
  contentTruncated?: boolean;
  replies: PublicCommentDto[];
}
