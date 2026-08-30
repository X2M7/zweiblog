import { BadRequestException } from '@nestjs/common';
import {
  normalizeCommentPaths,
  normalizeCommentPath,
  normalizeCreateComment,
  normalizeModerationStatus,
  normalizeCommentSetting,
} from './comment';

describe('comment input normalization', () => {
  it('accepts the native fields and the Waline content/path aliases', () => {
    expect(
      normalizeCreateComment({
        url: '/post/1/',
        comment: 'TeX: $x^2$',
        nick: ' Alice ',
        mail: 'ALICE@example.com',
        link: 'https://example.com/about',
      }),
    ).toEqual({
      path: '/post/1',
      content: 'TeX: $x^2$',
      nick: 'Alice',
      mail: 'alice@example.com',
      link: 'https://example.com/about',
      replyToId: undefined,
    });
  });

  it('keeps email optional while validating it when supplied', () => {
    expect(normalizeCreateComment({ path: '/post/1', content: 'hello', nick: 'Alice' }).mail).toBe(
      '',
    );
    expect(() =>
      normalizeCreateComment({
        path: '/post/1',
        content: 'hello',
        nick: 'Alice',
        mail: 'not-an-email',
      }),
    ).toThrow(BadRequestException);
  });

  it('uses an anonymous display name when nick is empty or omitted', () => {
    expect(normalizeCreateComment({ path: '/post/1', content: 'hello', nick: '' }).nick).toBe(
      '匿名访客',
    );
    expect(normalizeCreateComment({ path: '/post/1', content: 'hello' }).nick).toBe('匿名访客');
    expect(
      normalizeCreateComment({ path: '/post/1', content: 'hello', nick: null } as any).nick,
    ).toBe('匿名访客');
  });

  it('accepts exactly 50,000 comment characters and rejects 50,001', () => {
    expect(
      normalizeCreateComment({ path: '/post/1', content: 'x'.repeat(50_000), nick: 'Alice' })
        .content,
    ).toHaveLength(50_000);
    expect(() =>
      normalizeCreateComment({ path: '/post/1', content: 'x'.repeat(50_001), nick: 'Alice' }),
    ).toThrow(BadRequestException);
  });

  it('rejects remote paths, script links, structured fields and the honeypot', () => {
    expect(() => normalizeCommentPath('//evil.example/post')).toThrow(BadRequestException);
    expect(() => normalizeCommentPath('/post/1\nX-Injected: true')).toThrow(BadRequestException);
    expect(() =>
      normalizeCreateComment({ path: '/post/1', content: 'hello', nick: 'Alice\nAdmin' }),
    ).toThrow(BadRequestException);
    expect(() =>
      normalizeCreateComment({
        path: '/post/1',
        content: 'hello',
        nick: 'Alice',
        link: 'https://example.com/\r\nmalformed',
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      normalizeCreateComment({
        path: '/post/1',
        content: { $ne: '' },
        nick: 'Alice',
        mail: 'alice@example.com',
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      normalizeCreateComment({
        path: '/post/1',
        content: 'hello',
        nick: 'Alice',
        mail: 'alice@example.com',
        link: 'javascript:alert(1)',
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      normalizeCreateComment({
        path: '/post/1',
        content: 'hello',
        nick: 'Alice',
        mail: 'alice@example.com',
        website: 'bot-filled-value',
      }),
    ).toThrow(BadRequestException);
  });

  it('supports repeated, comma-separated and JSON path queries with a hard limit', () => {
    expect(normalizeCommentPaths(['/post/1', '/post/article,part'])).toEqual([
      '/post/1',
      '/post/article,part',
    ]);
    expect(normalizeCommentPaths('/post/2,/about')).toEqual(['/post/2', '/about']);
    expect(normalizeCommentPaths('["/post/1","/post/1/"]')).toEqual(['/post/1']);
    expect(() =>
      normalizeCommentPaths(Array.from({ length: 101 }, (_, i) => `/post/${i}`)),
    ).toThrow(BadRequestException);
  });

  it('canonicalizes browser-encoded Unicode and space paths', () => {
    expect(normalizeCommentPath('/post/%E4%B8%AD%E6%96%87%20slug/')).toBe('/post/中文 slug');
    expect(normalizeCommentPaths(['/post/%E4%B8%AD%E6%96%87', '/post/中文'])).toEqual([
      '/post/中文',
    ]);
    expect(() => normalizeCommentPath('/post/%E0%A4%A')).toThrow(BadRequestException);
    expect(() => normalizeCommentPath('/post/%0Aheader')).toThrow(BadRequestException);
  });

  it('accepts a legal long Unicode article path in browser-encoded form', () => {
    const slug = '文'.repeat(256);
    expect(normalizeCommentPath(`/post/${encodeURIComponent(slug)}`)).toBe(`/post/${slug}`);
  });

  it('only permits non-deleted moderation transitions', () => {
    expect(normalizeModerationStatus('approved')).toBe('approved');
    expect(() => normalizeModerationStatus('deleted')).toThrow(BadRequestException);
    expect(() => normalizeModerationStatus({ $ne: 'spam' })).toThrow(BadRequestException);
  });

  it('normalizes bounded local comment settings', () => {
    expect(normalizeCommentSetting({ moderation: 'all', maxLength: 3000 })).toEqual({
      moderation: 'all',
      maxLength: 3000,
      pageSize: 10,
    });
    expect(() => normalizeCommentSetting({ moderation: 'off', maxLength: 100_000 })).toThrow(
      BadRequestException,
    );
  });
});
