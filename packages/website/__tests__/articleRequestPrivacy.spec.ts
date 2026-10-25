import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPostPagesProps } from '../utils/getPageProps';
import { getArticleServerSideProps, isRequestRenderedArticlePath } from '../utils/requestPageProps';
import { getArticleByIdOrPathname } from '../api/getArticles';
import revalidate from '../pages/api/revalidate';

vi.mock('../utils/getPageProps', () => ({ getPostPagesProps: vi.fn() }));

const page = (article: Record<string, unknown> | null) => ({ article }) as any;
const context = (id: string, query: Record<string, string> = {}) =>
  ({
    params: { id },
    query: { id, ...query },
    res: { setHeader: vi.fn() },
  }) as any;

describe('request-time article privacy', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.stubEnv('isBuild', '');
  });

  it.each(['zh', 'en'] as const)(
    're-reads %s article and category protection without retaining old bodies or summaries',
    async (language) => {
      const publicArticle = {
        id: 1,
        pathname: 'current',
        content: 'private body',
        contentEn: 'private English body',
        summary: 'private summary',
        summaryEn: 'private English summary',
      };
      vi.mocked(getPostPagesProps)
        .mockResolvedValueOnce(page(publicArticle))
        .mockResolvedValueOnce(page({ id: 1, pathname: 'current', private: true }))
        .mockResolvedValueOnce(page({ id: 1, pathname: 'current', private: true }));

      const first = await getArticleServerSideProps(context('current'), language);
      expect(first).toHaveProperty('props.article.content', 'private body');
      for (const _protection of ['article', 'category']) {
        const ctx = context('current');
        const result = await getArticleServerSideProps(ctx, language);
        expect(result).toHaveProperty('props.article.private', true);
        expect(JSON.stringify(result)).not.toContain('private body');
        expect(JSON.stringify(result)).not.toContain('private summary');
        expect(JSON.stringify(result)).not.toContain('private English');
        expect(ctx.res.setHeader).toHaveBeenCalledWith(
          'Cache-Control',
          'private, no-store, no-cache, max-age=0, must-revalidate',
        );
        expect(ctx.res.setHeader).toHaveBeenCalledWith('x-middleware-cache', 'no-cache');
      }
      expect(getPostPagesProps).toHaveBeenCalledTimes(3);
    },
  );

  it.each(['001', '1.0', '1e0', '0x1', 'old-name'])(
    'redirects the alias %s without sending a body or persisting the redirect',
    async (id) => {
      vi.mocked(getPostPagesProps).mockResolvedValue(
        page({ id: 1, pathname: '新名称', content: 'body' }),
      );
      const ctx = context(id, { lang: 'en', __nextLocale: 'ignored', theme: 'dark' });
      const result = await getArticleServerSideProps(ctx, 'en');
      expect(result).toEqual({
        redirect: {
          destination: `/post/${encodeURIComponent('新名称')}?lang=en&theme=dark`,
          permanent: false,
        },
      });
      expect(ctx.res.setHeader).toHaveBeenCalledWith('x-middleware-cache', 'no-cache');
    },
  );

  it.each(['hidden', 'deleted', 'old-slug'])(
    'returns a fresh uncacheable 404 after %s disappears from the public API',
    async (id) => {
      vi.mocked(getPostPagesProps).mockResolvedValue(page(null));
      const ctx = context(id);
      expect(await getArticleServerSideProps(ctx)).toEqual({ notFound: true });
      expect(ctx.res.setHeader).toHaveBeenCalledWith('x-middleware-cache', 'no-cache');
    },
  );

  it('fails closed when the current permission check fails', async () => {
    vi.mocked(getPostPagesProps).mockRejectedValue(new Error('backend unavailable'));
    const ctx = context('1');
    await expect(getArticleServerSideProps(ctx)).rejects.toThrow('backend unavailable');
    expect(ctx.res.setHeader).toHaveBeenCalledWith('x-middleware-cache', 'no-cache');
  });

  it('escapes an article identifier as one API path segment and bypasses fetch caching', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ statusCode: 200, data: { article: { id: 1 } } }),
      });
    vi.stubGlobal('fetch', fetchMock);
    expect(await getArticleByIdOrPathname('name?password=123/#x')).toEqual({ article: { id: 1 } });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/public/article/name%3Fpassword%3D123%2F%23x'),
      { cache: 'no-store' },
    );
  });

  it.each([404, 500])('does not reuse a body after API status %s', async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status, json: async () => ({ statusCode: status }) }),
    );
    if (status === 404) {
      expect(await getArticleByIdOrPathname('current')).toEqual({ article: null });
    } else {
      await expect(getArticleByIdOrPathname('current')).rejects.toThrow(
        'current article permissions',
      );
    }
  });

  it.each([
    '/',
    '/post/001',
    '/page/2',
    '/category',
    '/category/旧分类',
    '/tag/旧标签',
    '/timeline',
  ])(
    'does not invoke SSG revalidation for request-rendered %s in either language',
    async (path) => {
      for (const target of [path, path === '/' ? '/en' : `/en${path}`]) {
        expect(isRequestRenderedArticlePath(target)).toBe(true);
        const res = { revalidate: vi.fn(), json: vi.fn() };
        await revalidate({ query: { path: target } }, res);
        expect(res.revalidate).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith({ revalidated: false, requestRendered: true });
      }
    },
  );

  it('still revalidates pages containing no article content', async () => {
    expect(isRequestRenderedArticlePath('/about')).toBe(false);
    const res = { revalidate: vi.fn().mockResolvedValue(undefined), json: vi.fn() };
    await revalidate({ query: { path: '/about' } }, res);
    expect(res.revalidate).toHaveBeenCalledWith('/about');
    expect(res.json).toHaveBeenCalledWith({ revalidated: true });
  });
});
