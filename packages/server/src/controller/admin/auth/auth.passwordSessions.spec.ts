import { AuthController } from './auth.controller';

function setup() {
  const user = { updateUser: jest.fn().mockResolvedValue({ modifiedCount: 1 }) };
  const tokens = { disableAll: jest.fn().mockResolvedValue({ modifiedCount: 2 }) };
  const cache = { get: jest.fn(() => 'recovery-test-key'), delete: jest.fn() };
  const init = { initRestoreKey: jest.fn().mockResolvedValue(undefined) };
  const controller = new AuthController(
    {} as any,
    user as any,
    {} as any,
    tokens as any,
    cache as any,
    init as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return { controller, user, tokens, cache, init };
}

describe('credential changes revoke existing sessions before responding', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it.each(['update', 'restore'])('awaits token revocation during %s', async (operation) => {
    const { controller, tokens } = setup();
    let finishRevocation!: () => void;
    tokens.disableAll.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishRevocation = resolve;
        }) as any,
    );
    const dto = { name: 'owner', password: 'new-password', key: 'recovery-test-key' };
    let completed = false;
    const pending = (
      operation === 'update' ? controller.updateUser(dto) : controller.restore(dto)
    ).then(() => {
      completed = true;
    });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(tokens.disableAll).toHaveBeenCalledTimes(1);
    expect(completed).toBe(false);
    finishRevocation();
    await pending;
    expect(completed).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });
});
