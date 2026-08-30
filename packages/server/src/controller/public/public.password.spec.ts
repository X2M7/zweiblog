import { PublicController } from './public.controller';

const makeController = () => {
  const articleProvider: any = {
    getByIdWithPassword: jest.fn().mockResolvedValue({ id: 7, content: 'unlocked' }),
  };
  const rateLimitProvider: any = {
    consume: jest.fn().mockResolvedValue({
      allowed: true,
      remaining: 9,
      retryAfterSeconds: 900,
    }),
    clear: jest.fn().mockResolvedValue(undefined),
  };
  const unused: any = {};
  const controller = new PublicController(
    articleProvider,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    rateLimitProvider,
  );
  return { controller, articleProvider, rateLimitProvider };
};

const request: any = {
  ip: '203.0.113.7',
  socket: { remoteAddress: '127.0.0.1' },
};

describe('public article password rate limiting', () => {
  it('uses a persistent limiter and clears failures after a successful unlock', async () => {
    const { controller, articleProvider, rateLimitProvider } = makeController();

    const response = await controller.getArticleByIdOrPathnameWithPassword(
      '007',
      { password: 'secret' },
      request,
    );

    expect(rateLimitProvider.consume).toHaveBeenCalledWith(
      'content-password',
      '203.0.113.7\u00007',
      10,
      900,
    );
    expect(articleProvider.getByIdWithPassword).toHaveBeenCalledWith('007', 'secret');
    expect(rateLimitProvider.clear).toHaveBeenCalledWith('content-password', '203.0.113.7\u00007');
    expect(response.data.content).toBe('unlocked');
  });

  it('rejects a rate-limited attempt before password verification', async () => {
    const { controller, articleProvider, rateLimitProvider } = makeController();
    rateLimitProvider.consume.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 123,
    });

    await expect(
      controller.getArticleByIdOrPathnameWithPassword('7', { password: 'guess' }, request),
    ).rejects.toMatchObject({ status: 429 });
    expect(articleProvider.getByIdWithPassword).not.toHaveBeenCalled();
  });
});
