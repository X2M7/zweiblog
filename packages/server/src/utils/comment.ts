import { BadRequestException } from '@nestjs/common';
import { isValidObjectId } from 'mongoose';
import {
  COMMENT_STATUSES,
  CreateCommentDto,
  ModeratableCommentStatus,
  NormalizedCreateCommentDto,
} from '../types/comment.dto';
import { CommentSetting, defaultCommentSetting } from '../types/setting.dto';

export const COMMENT_CONTENT_MAX_LENGTH = 50_000;
export const COMMENT_STORED_CONTENT_MAX_LENGTH = 50_000;
export const COMMENT_PATH_MAX_LENGTH = 512;
export const COMMENT_PATH_ENCODED_MAX_LENGTH = 4_096;

const UNSAFE_CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const MULTILINE_CHARACTERS = /[\r\n\t\u2028\u2029]/u;

function requireString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') {
    throw new BadRequestException(`${field} must be a string`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || UNSAFE_CONTROL_CHARACTERS.test(normalized)) {
    throw new BadRequestException(`Invalid ${field}`);
  }
  return normalized;
}

function requireSingleLineString(value: unknown, field: string, maxLength: number): string {
  const normalized = requireString(value, field, maxLength);
  if (MULTILINE_CHARACTERS.test(normalized)) {
    throw new BadRequestException(`Invalid ${field}`);
  }
  return normalized;
}

export function normalizeCommentPath(value: unknown): string {
  const rawPath = requireSingleLineString(value, 'path', COMMENT_PATH_ENCODED_MAX_LENGTH);
  let path: string;
  try {
    // Browsers expose non-ASCII pathnames percent-encoded while article data
    // and old Waline records usually contain their decoded form. decodeURI
    // preserves reserved separators such as encoded slashes and gives every
    // comment entry point one canonical representation.
    path = decodeURI(rawPath).normalize('NFC');
  } catch {
    throw new BadRequestException('Invalid comment path encoding');
  }
  if (
    path.length > COMMENT_PATH_MAX_LENGTH ||
    UNSAFE_CONTROL_CHARACTERS.test(path) ||
    MULTILINE_CHARACTERS.test(path)
  ) {
    throw new BadRequestException('Invalid comment path');
  }
  if (
    !path.startsWith('/') ||
    path.startsWith('//') ||
    path.includes('\\') ||
    path.includes('?') ||
    path.includes('#')
  ) {
    throw new BadRequestException('Invalid comment path');
  }
  const collapsed = path.replace(/\/{2,}/gu, '/');
  return collapsed.length > 1 ? collapsed.replace(/\/+$/u, '') : collapsed;
}

export function normalizeCommentLink(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  const link = requireSingleLineString(value, 'link', 500);
  let parsed: URL;
  try {
    parsed = new URL(link);
  } catch {
    throw new BadRequestException('Invalid link');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new BadRequestException('Only public HTTP(S) profile links are allowed');
  }
  return parsed.toString();
}

export function normalizeCommentEmail(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  const mail = requireString(value, 'mail', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(mail)) {
    throw new BadRequestException('Invalid mail');
  }
  return mail;
}

export function normalizeCommentContent(
  value: unknown,
  maxLength = COMMENT_CONTENT_MAX_LENGTH,
): string {
  const boundedMaxLength = Math.max(
    1,
    Math.min(COMMENT_STORED_CONTENT_MAX_LENGTH, Math.floor(Number(maxLength) || 0)),
  );
  const content = requireString(value, 'content', boundedMaxLength);
  if (content.length > boundedMaxLength) {
    throw new BadRequestException('Comment content is too long');
  }
  return content;
}

export function normalizeCommentId(value: unknown, required = false): string | undefined {
  if (value === undefined || value === null || value === '') {
    if (required) throw new BadRequestException('A valid comment id is required');
    return undefined;
  }
  if (typeof value !== 'string' || !isValidObjectId(value)) {
    throw new BadRequestException('Invalid comment id');
  }
  return value;
}

export function normalizeCreateComment(
  body: CreateCommentDto,
  contentMaxLength = COMMENT_CONTENT_MAX_LENGTH,
): NormalizedCreateCommentDto {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('Invalid comment body');
  }
  if (body.website !== undefined && body.website !== null && body.website !== '') {
    throw new BadRequestException('Invalid comment body');
  }
  return {
    path: normalizeCommentPath(body.path ?? body.url),
    content: normalizeCommentContent(body.content ?? body.comment, contentMaxLength),
    nick:
      body.nick === undefined || body.nick === null || body.nick === ''
        ? '匿名访客'
        : requireSingleLineString(body.nick, 'nick', 80),
    mail: normalizeCommentEmail(body.mail),
    link: normalizeCommentLink(body.link),
    replyToId: normalizeCommentId(body.replyToId ?? body.parentId),
  };
}

export function normalizeModerationStatus(value: unknown): ModeratableCommentStatus {
  if (
    typeof value !== 'string' ||
    !COMMENT_STATUSES.includes(value as any) ||
    value === 'deleted'
  ) {
    throw new BadRequestException('Invalid comment status');
  }
  return value as ModeratableCommentStatus;
}

export function normalizeCommentPaths(value: unknown): string[] {
  let raw: unknown[];
  if (Array.isArray(value)) {
    // Express uses an array for repeated `paths=` parameters. A comma is a
    // legal article-path character, so array items must remain intact. Legacy
    // clients that send one comma-separated string are still accepted below.
    raw = value;
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (!Array.isArray(parsed)) throw new Error('not an array');
        raw = parsed;
      } catch {
        throw new BadRequestException('Invalid paths query');
      }
    } else {
      raw = trimmed.split(',');
    }
  } else {
    throw new BadRequestException('At least one path is required');
  }
  const paths = [...new Set(raw.map(normalizeCommentPath))];
  if (paths.length === 0 || paths.length > 100) {
    throw new BadRequestException('Between 1 and 100 paths are required');
  }
  return paths;
}

export function normalizeCommentSetting(
  value: unknown,
  base: CommentSetting = defaultCommentSetting,
): CommentSetting {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('Invalid comment setting');
  }
  const input = value as Partial<Record<keyof CommentSetting, unknown>>;
  const moderation = input.moderation ?? base.moderation;
  const pageSize = input.pageSize ?? base.pageSize;
  const maxLength = input.maxLength ?? base.maxLength;
  if (!['all', 'suspicious', 'off'].includes(String(moderation))) {
    throw new BadRequestException('Invalid comment moderation mode');
  }
  if (!Number.isInteger(pageSize) || Number(pageSize) < 5 || Number(pageSize) > 10) {
    throw new BadRequestException('Comment pageSize must be between 5 and 10');
  }
  if (!Number.isInteger(maxLength) || Number(maxLength) < 100 || Number(maxLength) > 50_000) {
    throw new BadRequestException('Comment maxLength must be between 100 and 50000');
  }
  return {
    moderation: moderation as CommentSetting['moderation'],
    pageSize: Number(pageSize),
    maxLength: Number(maxLength),
  };
}
