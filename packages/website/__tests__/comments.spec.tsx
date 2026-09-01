import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_COMMENT_RENDER_DEPTH,
  createComment,
  getCommentCounts,
  getComments,
  likeComment,
  normalizeCommentPath,
  uploadCommentImage,
  type LocalComment,
} from '../api/comments';
import {
  COMMENT_FORM_PLACEHOLDERS,
  CommentItem,
} from '../components/Comments/core';

function jsonResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data }),
  } as Response;
}

describe('local comment API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses one decoded path for list, create, and count requests', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ items: [], total: 0, page: 1, pageSize: 20, maxLength: 50000 }),
      )
      .mockResolvedValueOnce(jsonResponse({ moderated: false }))
      .mockResolvedValueOnce(jsonResponse({ '/post/中文 slug': 2 }));
    vi.stubGlobal('fetch', fetchMock);

    const encodedPath = '/post/%E4%B8%AD%E6%96%87%20slug';
    await getComments(encodedPath, 1, 20);
    await createComment({ path: encodedPath, nick: '访客', content: 'hello' });
    await getCommentCounts([encodedPath, '/post/中文 slug', '/post/part,section']);

    const listUrl = new URL(String(fetchMock.mock.calls[0][0]), 'https://blog.local');
    expect(listUrl.searchParams.get('path')).toBe('/post/中文 slug');

    const createBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(createBody.path).toBe('/post/中文 slug');

    const countUrl = new URL(String(fetchMock.mock.calls[2][0]), 'https://blog.local');
    expect(JSON.parse(String(countUrl.searchParams.get('paths')))).toEqual([
      '/post/中文 slug',
      '/post/part,section',
    ]);
  });

  it('keeps malformed escapes stable for server-side validation', () => {
    expect(normalizeCommentPath('/post/%E4%A')).toBe('/post/%E4%A');
    expect(normalizeCommentPath('')).toBe('/');
  });

  it('uses one stable thread key across language and fragment variants', () => {
    expect(normalizeCommentPath('/post/1?lang=en#x')).toBe('/post/1');
    expect(normalizeCommentPath('/en/post/1?lang=en')).toBe('/post/1');
    expect(normalizeCommentPath('/en/post/1')).toBe(
      normalizeCommentPath('/post/1'),
    );
  });

  it('preserves admin/deleted flags and caps recursive reply normalization', async () => {
    let nested: any = { id: 'leaf', content: 'leaf', replies: [] };
    for (let index = MAX_COMMENT_RENDER_DEPTH; index >= 0; index -= 1) {
      nested = { id: String(index), content: `reply ${index}`, replies: [nested] };
    }
    nested.isAdmin = true;
    nested.deleted = false;
    nested.location = '中国 北京市';
    nested.browser = 'Chrome 128';
    nested.os = 'Windows 11';

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          items: [nested, { id: 'deleted', deleted: true, replies: [] }],
          total: 2,
          page: 1,
          pageSize: 20,
          maxLength: 50000,
          truncatedReplies: true,
        }),
      ),
    );

    const page = await getComments('/post/1', 1, 20);
    expect(page.items[0].isAdmin).toBe(true);
    expect(page.items[0]).toMatchObject({
      location: '中国 北京市',
      browser: 'Chrome 128',
      os: 'Windows 11',
    });
    expect(page.items[1].deleted).toBe(true);
    expect(page.maxLength).toBe(50000);
    expect(page.truncatedReplies).toBe(true);

    let cursor = page.items[0];
    for (let depth = 0; depth < MAX_COMMENT_RENDER_DEPTH; depth += 1) {
      expect(cursor.replies).toHaveLength(1);
      cursor = cursor.replies[0];
    }
    expect(cursor.replies).toEqual([]);
    expect(cursor.repliesTruncated).toBe(true);
  });

  it('uses the server toggle result when liking and can upload local images', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ liked: false, likes: 3 }))
      .mockResolvedValueOnce(jsonResponse({ src: '/static/comment/example.webp' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(likeComment('comment/1')).resolves.toEqual({ liked: false, likes: 3 });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/public/comment/comment%2F1/like');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', body: '{}' });

    const file = new File(['image'], 'example.webp', { type: 'image/webp' });
    await expect(uploadCommentImage(file)).resolves.toBe('/static/comment/example.webp');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/public/comment/image');
    expect(fetchMock.mock.calls[1][1]?.body).toBeInstanceOf(FormData);
    expect((fetchMock.mock.calls[1][1]?.body as FormData).get('file')).toMatchObject({
      name: 'example.webp',
      type: 'image/webp',
      size: 5,
    });
  });
});

describe('local comment rendering', () => {
  it('uses concise matching Chinese and English form prompts', () => {
    expect(COMMENT_FORM_PLACEHOLDERS).toEqual({
      nick: { zh: '昵称（可选）', en: 'Name (optional)' },
      mail: {
        zh: '邮箱（仅站长可见）',
        en: 'Email (visible to site owner only)',
      },
      link: { zh: '个人网址（可选）', en: 'Website (optional)' },
      content: { zh: '欢迎评论', en: 'Leave a comment' },
    });
  });

  it('labels administrator comments', () => {
    const comment: LocalComment = {
      id: 'admin',
      nick: 'Owner',
      content: 'Official reply',
      path: '/post/1',
      likes: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      isAdmin: true,
      location: '中国 北京市',
      browser: 'Chrome 128',
      os: 'Windows 11',
      deleted: false,
      repliesTruncated: false,
      replies: [],
    };
    const html = renderToStaticMarkup(
      createElement(CommentItem, {
        comment,
        rootId: comment.id,
        liked: new Set<string>(),
        onReply: () => undefined,
        onLike: () => undefined,
      }),
    );

    expect(html).toContain('站长');
    expect(html).toContain('Official reply');
    expect(html).toContain('中国 北京市 · Chrome 128 · Windows 11');
    expect(html).toContain('aria-label="点赞"');
    expect(html).toContain('aria-label="回复 Owner"');
    expect(html).not.toContain('>点赞<');
  });

  it('renders deleted placeholders without like or reply actions', () => {
    const comment: LocalComment = {
      id: 'deleted',
      nick: '已删除',
      content: 'untrusted stale content',
      path: '/post/1',
      likes: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      isAdmin: false,
      deleted: true,
      repliesTruncated: false,
      replies: [],
    };
    const html = renderToStaticMarkup(
      createElement(CommentItem, {
        comment,
        rootId: comment.id,
        liked: new Set<string>(),
        onReply: () => undefined,
        onLike: () => undefined,
      }),
    );

    expect(html).toContain('该评论已删除');
    expect(html).not.toContain('untrusted stale content');
    expect(html).not.toContain('点赞');
    expect(html).not.toContain('回复');
  });
});
