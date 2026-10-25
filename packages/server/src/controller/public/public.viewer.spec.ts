import { ForbiddenException } from '@nestjs/common';
import { PublicController } from './public.controller';

const makeController = () => {
  const metaProvider: any = {
    addViewer: jest.fn().mockResolvedValue({ viewer: 2, visited: 1 }),
  };
  const unused: any = {};
  const rateLimitProvider: any = { consume: jest.fn().mockResolvedValue({ allowed: true }) };
  const articleProvider: any = {
    getViewerTarget: jest.fn().mockResolvedValue(null),
    getTotalNum: jest.fn().mockResolvedValue(10),
    hasViewerTaxonomy: jest.fn().mockResolvedValue(false),
  };
  const customPageProvider: any = { getCustomPageByPath: jest.fn().mockResolvedValue(null) };
  const visitProvider: any = { getByArticleId: jest.fn().mockResolvedValue({ viewer: 11 }) };
  const controller = new PublicController(
    articleProvider,
    unused,
    unused,
    metaProvider,
    visitProvider,
    unused,
    customPageProvider,
    rateLimitProvider,
  );
  return {
    controller,
    metaProvider,
    rateLimitProvider,
    articleProvider,
    customPageProvider,
    visitProvider,
  };
};

const request = (overrides: Record<string, unknown> = {}): any => ({
  protocol: 'http',
  headers: { referer: 'http://127.0.0.1:3001/about' },
  socket: { remoteAddress: '127.0.0.1' },
  app: { get: jest.fn(() => (address: string) => address === '127.0.0.1') },
  get: jest.fn((name: string) => (name === 'host' ? '127.0.0.1:3000' : undefined)),
  ...overrides,
});

describe('public viewer same-origin validation', () => {
  it('accepts the browser-facing host from a trusted local Next proxy', async () => {
    const { controller, metaProvider } = makeController();
    const req = request({
      headers: {
        referer: 'http://127.0.0.1:3001/about',
        'x-forwarded-host': '127.0.0.1:3001',
      },
    });

    await expect(controller.addViewer(true, true, req)).resolves.toEqual({
      statusCode: 200,
      data: { viewer: 2, visited: 1 },
    });
    expect(metaProvider.addViewer).toHaveBeenCalledWith(true, '/about', true, undefined);
  });

  it('ignores a forged forwarded host from an untrusted peer', async () => {
    const { controller, metaProvider } = makeController();
    const req = request({
      headers: {
        referer: 'http://127.0.0.1:3001/about',
        'x-forwarded-host': '127.0.0.1:3001',
      },
      socket: { remoteAddress: '203.0.113.8' },
      app: { get: jest.fn(() => () => false) },
    });

    await expect(controller.addViewer(true, true, req)).rejects.toBeInstanceOf(ForbiddenException);
    expect(metaProvider.addViewer).not.toHaveBeenCalled();
  });
});

describe('bounded real-path viewer writes', () => {
  const sameOrigin = (path: string) =>
    request({ headers: { referer: `http://127.0.0.1:3000${path}` } });
  it.each([
    '/random-record',
    '/%2foutside.example',
    '/%5coutside.example',
    '/%00bad',
    '/bad%',
    '/page/999999999',
    '/post/not-real',
    '/tag/not-real',
  ])('rejects invalid or nonexistent path %s', async (path) => {
    const { controller, metaProvider } = makeController();
    await expect(controller.addViewer(true, true, sameOrigin(path))).rejects.toMatchObject({
      status: 400,
    });
    expect(metaProvider.addViewer).not.toHaveBeenCalled();
  });
  it('enforces fixed global and IP limits before resolving any target', async () => {
    const { controller, rateLimitProvider, articleProvider, customPageProvider, metaProvider } =
      makeController();
    rateLimitProvider.consume
      .mockResolvedValueOnce({ allowed: true })
      .mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 20 });
    await expect(controller.addViewer(true, true, sameOrigin('/post/7'))).rejects.toMatchObject({
      status: 429,
    });
    expect(rateLimitProvider.consume.mock.calls.map((call) => call[0])).toEqual([
      'viewer-global',
      'viewer-ip',
    ]);
    expect(articleProvider.getViewerTarget).not.toHaveBeenCalled();
    expect(customPageProvider.getCustomPageByPath).not.toHaveBeenCalled();
    expect(metaProvider.addViewer).not.toHaveBeenCalled();
  });
  it.each(['/post/007', '/post/slug', '/en/post/slug', '/post/%73lug'])(
    'shares one stable record for article alias %s',
    async (path) => {
      const { controller, articleProvider, metaProvider } = makeController();
      articleProvider.getViewerTarget.mockResolvedValue({
        id: 7,
        pathname: 'slug',
        viewer: 10,
        visited: 3,
      });
      await controller.addViewer(false, false, sameOrigin(path));
      expect(metaProvider.addViewer).toHaveBeenCalledWith(false, '/post/7', false, {
        viewer: 10,
        visited: 3,
        aliases: ['/post/slug', '/en/post/slug'],
      });
    },
  );
  it.each(['/en/about', '/about/'])('normalizes builtin alias %s', async (path) => {
    const { controller, metaProvider } = makeController();
    await controller.addViewer(false, false, sameOrigin(path));
    expect(metaProvider.addViewer).toHaveBeenCalledWith(false, '/about', false, undefined);
  });
  it('uses a shared index counter for real pagination', async () => {
    const { controller, metaProvider } = makeController();
    await controller.addViewer(false, false, sameOrigin('/page/2'));
    expect(metaProvider.addViewer).toHaveBeenCalledWith(false, '/', false, undefined);
  });
  it('accepts an existing article slug containing spaces', async () => {
    const { controller, articleProvider, metaProvider } = makeController();
    articleProvider.getViewerTarget.mockResolvedValue({ id: 7, pathname: 'my article' });
    await controller.addViewer(false, false, sameOrigin('/post/my%20article'));
    expect(articleProvider.getViewerTarget).toHaveBeenCalledWith('my article');
    expect(metaProvider.addViewer.mock.calls[0][1]).toBe('/post/7');
  });
  it('resolves slug reads to the same article aggregate', async () => {
    const { controller, articleProvider, visitProvider } = makeController();
    const article = { id: 7, pathname: 'slug', viewer: 10, visited: 3 };
    articleProvider.getViewerTarget.mockResolvedValue(article);
    await controller.getViewerByArticleIdOrPathname('slug');
    expect(visitProvider.getByArticleId).toHaveBeenCalledWith(7, article);
  });
});
