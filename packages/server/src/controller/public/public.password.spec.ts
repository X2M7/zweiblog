import { PublicController } from './public.controller';

const makeController = () => {
  const target = { identity: 'article:record-7' };
  const articleProvider: any = {
    resolvePasswordTarget: jest.fn().mockResolvedValue(target),
    getByIdWithPassword: jest.fn().mockResolvedValue({ id: 7, content: 'unlocked' }),
  };
  const rateLimitProvider: any = {
    consume: jest.fn().mockResolvedValue({ allowed: true, remaining: 9, retryAfterSeconds: 900 }),
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
  return { controller, articleProvider, rateLimitProvider, target };
};
const request: any = { ip: '203.0.113.7', socket: { remoteAddress: '127.0.0.1' } };

describe('public article password rate limiting', () => {
  it.each(['007', '7', 'slug', ' slug ', '%73lug'])(
    'uses the resolved article identity for alias %s',
    async (id) => {
      const { controller, articleProvider, rateLimitProvider, target } = makeController();
      await controller.getArticleByIdOrPathnameWithPassword(id, { password: 'secret' }, request);
      expect(rateLimitProvider.consume).toHaveBeenNthCalledWith(
        1,
        'content-password-global',
        'site',
        300,
        900,
      );
      expect(rateLimitProvider.consume).toHaveBeenNthCalledWith(
        2,
        'content-password-ip',
        '203.0.113.7',
        30,
        900,
      );
      expect(rateLimitProvider.consume).toHaveBeenNthCalledWith(
        3,
        'content-password',
        '203.0.113.7\0article:record-7',
        10,
        900,
      );
      expect(articleProvider.getByIdWithPassword).toHaveBeenCalledWith(id, 'secret', target);
      expect(rateLimitProvider.clear).toHaveBeenCalledWith(
        'content-password',
        '203.0.113.7\0article:record-7',
      );
    },
  );
  it('shares the category bucket across different articles using the same password', async () => {
    const { controller, articleProvider, rateLimitProvider } = makeController();
    articleProvider.resolvePasswordTarget.mockResolvedValue({ identity: 'category:record-2' });
    articleProvider.getByIdWithPassword.mockResolvedValue(null);
    await controller.getArticleByIdOrPathnameWithPassword('7', { password: 'guess' }, request);
    await controller.getArticleByIdOrPathnameWithPassword('8', { password: 'guess' }, request);
    const entityCalls = rateLimitProvider.consume.mock.calls.filter(
      ([scope]) => scope === 'content-password',
    );
    expect(entityCalls.map((call) => call[1])).toEqual([
      '203.0.113.7\0category:record-2',
      '203.0.113.7\0category:record-2',
    ]);
    expect(rateLimitProvider.clear).not.toHaveBeenCalled();
  });
  it('rejects a fixed-scope limit before entity lookup or password verification', async () => {
    const { controller, articleProvider, rateLimitProvider } = makeController();
    rateLimitProvider.consume.mockResolvedValue({ allowed: false, retryAfterSeconds: 123 });
    await expect(
      controller.getArticleByIdOrPathnameWithPassword('7', { password: 'guess' }, request),
    ).rejects.toMatchObject({ status: 429 });
    expect(articleProvider.resolvePasswordTarget).not.toHaveBeenCalled();
    expect(articleProvider.getByIdWithPassword).not.toHaveBeenCalled();
  });
  it('does not create per-target buckets for nonexistent article names', async () => {
    const { controller, articleProvider, rateLimitProvider } = makeController();
    articleProvider.resolvePasswordTarget.mockResolvedValue(null);
    await expect(
      controller.getArticleByIdOrPathnameWithPassword('missing', { password: 'guess' }, request),
    ).resolves.toMatchObject({ data: null });
    expect(rateLimitProvider.consume).toHaveBeenCalledTimes(2);
    expect(articleProvider.getByIdWithPassword).not.toHaveBeenCalled();
  });
});
