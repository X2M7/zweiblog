import { PublicCommentController } from './comment.controller';

describe('PublicCommentController rate-limit ordering', () => {
  const commentProvider: any = {
    assertPublicTarget: jest.fn(),
    create: jest.fn(),
    assertLikeable: jest.fn(),
    like: jest.fn(),
  };
  const rateLimitProvider: any = {
    consume: jest.fn(),
  };
  const commentMaintenanceProvider: any = {
    withExclusive: jest.fn((_operation, action) => action({ assertOwned: jest.fn() })),
  };
  const controller = new PublicCommentController(
    commentProvider,
    rateLimitProvider,
    commentMaintenanceProvider,
  );
  const request: any = {
    ip: '203.0.113.9',
    socket: {},
    secure: true,
    protocol: 'https',
    headers: { 'content-type': 'application/json', origin: 'https://blog.example' },
    get: jest.fn((name: string) => {
      if (name === 'host') return 'blog.example';
      if (name === 'user-agent') return 'TestBrowser/1.0';
      return undefined;
    }),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    rateLimitProvider.consume.mockResolvedValue({
      allowed: true,
      remaining: 1,
      retryAfterSeconds: 1,
    });
    commentProvider.assertPublicTarget.mockResolvedValue({
      path: '/post/1',
      articleId: 1,
      aliases: ['/post/1'],
    });
    commentProvider.create.mockImplementation(async (_body, _target, beforeInsert) => {
      await beforeInsert?.();
      return {};
    });
    commentProvider.assertLikeable.mockResolvedValue('507f1f77bcf86cd799439011');
    commentProvider.like.mockResolvedValue({
      id: '507f1f77bcf86cd799439011',
      likes: 1,
      liked: true,
    });
  });

  it('consumes one fixed IP bucket before validating and scoping a create', async () => {
    await controller.create({ path: '/post/1', content: 'hello', nick: 'Alice' }, request);
    expect(rateLimitProvider.consume.mock.calls).toEqual([
      ['comment:create:ip', '203.0.113.9', 20, 600],
      ['comment:create:target', '203.0.113.9\0article:1', 5, 600],
      ['comment:create:target-hour', 'article:1', 30, 3600],
      ['comment:create:target-day', 'article:1', 100, 86400],
    ]);
    expect(commentProvider.assertPublicTarget).toHaveBeenCalledWith('/post/1');
    expect(commentMaintenanceProvider.withExclusive).toHaveBeenCalledWith(
      'public-comment-create',
      expect.any(Function),
    );
    expect(commentProvider.create).toHaveBeenCalledWith(
      { path: '/post/1', content: 'hello', nick: 'Alice' },
      expect.objectContaining({ path: '/post/1', articleId: 1 }),
      expect.any(Function),
      { ip: '203.0.113.9', ua: 'TestBrowser/1.0' },
    );
  });

  it('does not create a per-path limiter row for an unavailable target', async () => {
    commentProvider.assertPublicTarget.mockRejectedValueOnce(new Error('unavailable'));
    await expect(
      controller.create({ path: '/rotating-attacker-path', content: 'x', nick: 'bot' }, request),
    ).rejects.toThrow('unavailable');
    expect(rateLimitProvider.consume).toHaveBeenCalledTimes(1);
    expect(rateLimitProvider.consume).toHaveBeenCalledWith(
      'comment:create:ip',
      '203.0.113.9',
      20,
      600,
    );
  });

  it('validates a real comment before creating the item-specific like bucket', async () => {
    const id = '507f1f77bcf86cd799439011';
    const response: any = { cookie: jest.fn() };
    await expect(controller.like(id, request, response)).resolves.toEqual({
      statusCode: 200,
      data: { id, likes: 1, liked: true },
    });
    expect(rateLimitProvider.consume.mock.calls).toEqual([
      ['comment:like:ip', '203.0.113.9', 200, 86_400],
      ['comment:like:item', `203.0.113.9\0${id}`, 20, 600],
    ]);
    expect(commentProvider.assertLikeable).toHaveBeenCalledWith(id);
    expect(response.cookie).toHaveBeenCalledWith(
      'zweiblog_comment_actor',
      expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
      {
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        maxAge: 365 * 24 * 60 * 60 * 1_000,
        path: '/',
      },
    );
    expect(commentProvider.like).toHaveBeenCalledWith(id, expect.stringMatching(/^[a-f0-9]{64}$/u));
    expect(commentMaintenanceProvider.withExclusive).toHaveBeenCalledWith(
      'comment-like',
      expect.any(Function),
    );
  });

  it('reuses a valid reaction cookie instead of replacing the browser identity', async () => {
    const id = '507f1f77bcf86cd799439011';
    const response: any = { cookie: jest.fn() };
    const requestWithCookie = {
      ...request,
      headers: {
        ...request.headers,
        cookie: `unrelated=1; zweiblog_comment_actor=${'a'.repeat(43)}`,
      },
    };

    await controller.like(id, requestWithCookie, response);

    expect(response.cookie).not.toHaveBeenCalled();
    expect(commentProvider.like).toHaveBeenCalledWith(id, expect.stringMatching(/^[a-f0-9]{64}$/u));
  });

  it('rejects form and cross-site browser posts before consuming a limiter', async () => {
    await expect(
      controller.create(
        { path: '/post/1', content: 'csrf', nick: 'bot' },
        { ...request, headers: { 'content-type': 'application/x-www-form-urlencoded' } },
      ),
    ).rejects.toThrow('application/json');
    await expect(
      controller.create(
        { path: '/post/1', content: 'csrf', nick: 'bot' },
        {
          ...request,
          headers: {
            'content-type': 'application/json',
            origin: 'https://attacker.example',
            'sec-fetch-site': 'cross-site',
          },
        },
      ),
    ).rejects.toThrow('Cross-site');
    expect(rateLimitProvider.consume).not.toHaveBeenCalled();
  });

  it('uses a trusted proxy host for the Next local-preview rewrite', async () => {
    await expect(
      controller.create(
        { path: '/post/1', content: 'local preview', nick: 'Alice' },
        {
          ...request,
          socket: { remoteAddress: '127.0.0.1' },
          app: {
            get: jest.fn((name: string) =>
              name === 'trust proxy fn' ? (address: string) => address === '127.0.0.1' : undefined,
            ),
          },
          headers: {
            'content-type': 'application/json',
            origin: 'http://localhost:3001',
            'x-forwarded-host': 'localhost:3001',
          },
          protocol: 'http',
          get: jest.fn((name: string) => (name === 'host' ? '127.0.0.1:3000' : undefined)),
        },
      ),
    ).resolves.toMatchObject({ statusCode: 200 });
  });

  it('does not trust a forwarded host from an untrusted direct client', async () => {
    await expect(
      controller.create(
        { path: '/post/1', content: 'spoof', nick: 'bot' },
        {
          ...request,
          socket: { remoteAddress: '198.51.100.7' },
          app: { get: jest.fn(() => () => false) },
          headers: {
            'content-type': 'application/json',
            origin: 'https://attacker.example',
            'x-forwarded-host': 'attacker.example',
          },
        },
      ),
    ).rejects.toThrow('Cross-site');
    expect(rateLimitProvider.consume).not.toHaveBeenCalled();
  });

  it('turns a malformed host into a forbidden response instead of a URL error', async () => {
    await expect(
      controller.create(
        { path: '/post/1', content: 'bad host', nick: 'bot' },
        { ...request, get: jest.fn(() => 'bad/host') },
      ),
    ).rejects.toThrow('valid request host');
    expect(rateLimitProvider.consume).not.toHaveBeenCalled();
  });
});
