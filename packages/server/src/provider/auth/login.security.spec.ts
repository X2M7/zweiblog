import { LoginGuard } from './login.guard';
import { LocalStrategy } from './local.strategy';

const make = () => {
  const limits: any = { consume: jest.fn().mockResolvedValue({ allowed: true }), clear: jest.fn() };
  const settings: any = {
    getLoginSetting: jest
      .fn()
      .mockResolvedValue({ enableMaxLoginRetry: true, maxRetryTimes: 5, durationSeconds: 60 }),
  };
  const auth: any = { validateUser: jest.fn().mockResolvedValue({ id: 0 }) };
  return {
    guard: new LoginGuard(limits, settings),
    strategy: new LocalStrategy(auth),
    limits,
    auth,
    settings,
  };
};
const request = (body: any, query: any = {}): any => ({ body, query, ip: '203.0.113.5' });

describe('body-only login credentials', () => {
  it.each([
    request({ username: '', password: 'guess' }, { username: 'owner' }),
    request({ username: 0, password: 'guess' }, { username: 'owner' }),
    request({ username: ['owner'], password: 'guess' }),
    request({ username: { name: 'owner' }, password: 'guess' }),
    request({ username: 'owner', password: ['guess'] }),
    request({ username: 'owner', password: 'guess' }, { password: 'other' }),
  ])('rejects fallback or non-string credentials before authentication', async (req) => {
    const { guard, strategy, auth, limits } = make();
    await expect(guard.validateRequest(req)).rejects.toMatchObject({ status: 400 });
    await expect(strategy.validate(req, 'owner', 'guess')).rejects.toMatchObject({ status: 400 });
    expect(auth.validateUser).not.toHaveBeenCalled();
    expect(limits.consume).not.toHaveBeenCalled();
  });
  it('reads the same username and password for limiting and authentication', async () => {
    const { guard, strategy, auth, limits } = make();
    const req = request({ username: 'Owner', password: 'secret' });
    await guard.validateRequest(req);
    await strategy.validate(req, 'query-user', 'query-password');
    expect(limits.consume).toHaveBeenCalledWith('login', '203.0.113.5\0owner', 5, 60);
    expect(auth.validateUser).toHaveBeenCalledWith('Owner', 'secret');
  });
  it('also rejects malformed credentials when optional retry limiting is disabled', async () => {
    const { guard, settings } = make();
    settings.getLoginSetting.mockResolvedValue({ enableMaxLoginRetry: false });
    await expect(
      guard.validateRequest(request({ username: 0, password: 'x' })),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('fixed login abuse budgets', () => {
  it('checks the site and IP budgets before settings or username buckets', async () => {
    const { guard, settings, limits } = make();
    await guard.validateRequest(request({ username: 'owner', password: 'secret' }));
    expect(limits.consume.mock.calls.map((call) => call[0])).toEqual([
      'login-global',
      'login-ip',
      'login',
    ]);
    expect(limits.consume).toHaveBeenNthCalledWith(1, 'login-global', 'site', 300, 60);
    expect(limits.consume).toHaveBeenNthCalledWith(2, 'login-ip', '203.0.113.5', 30, 60);
    expect(limits.consume.mock.invocationCallOrder[1]).toBeLessThan(
      settings.getLoginSetting.mock.invocationCallOrder[0],
    );
  });
  it('rejects the fixed IP limit without creating arbitrary username buckets', async () => {
    const { guard, settings, limits } = make();
    limits.consume
      .mockResolvedValueOnce({ allowed: true })
      .mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 60 });
    await expect(
      guard.validateRequest(request({ username: 'random-account', password: 'guess' })),
    ).rejects.toMatchObject({ status: 429 });
    expect(settings.getLoginSetting).not.toHaveBeenCalled();
    expect(limits.consume).toHaveBeenCalledTimes(2);
  });
  it('keeps fixed budgets when optional account retry limiting is disabled', async () => {
    const { guard, settings, limits } = make();
    settings.getLoginSetting.mockResolvedValue({ enableMaxLoginRetry: false });
    await expect(
      guard.validateRequest(request({ username: 'owner', password: 'secret' })),
    ).resolves.toBe(true);
    expect(limits.consume.mock.calls.map((call) => call[0])).toEqual(['login-global', 'login-ip']);
  });
});
