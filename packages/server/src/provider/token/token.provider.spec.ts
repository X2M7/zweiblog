jest.mock('../setting/setting.provider', () => ({ SettingProvider: class SettingProvider {} }));

import { TokenProvider } from './token.provider';
import { API_TOKEN_USER_ID, hashToken } from './token.security';

function queryResult<T>(value: T) {
  const query: any = {};
  query.select = jest.fn(() => query);
  query.sort = jest.fn(() => query);
  query.lean = jest.fn(() => query);
  query.exec = jest.fn().mockResolvedValue(value);
  return query;
}

function createProvider(modelOverrides: Record<string, any> = {}) {
  const tokenModel: any = {
    create: jest.fn().mockResolvedValue({}),
    find: jest.fn(),
    findOne: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({ acknowledged: true, matchedCount: 1 }),
    updateMany: jest.fn().mockResolvedValue({ acknowledged: true }),
    ...modelOverrides,
  };
  const jwtService: any = {
    sign: jest.fn().mockReturnValue('raw.jwt.token'),
  };
  const settingProvider: any = {
    getLoginSetting: jest.fn().mockResolvedValue({ expiresIn: 3600 }),
  };
  return {
    provider: new TokenProvider(tokenModel, jwtService, settingProvider),
    tokenModel,
    jwtService,
  };
}

describe('TokenProvider secure persistence', () => {
  it('stores only a SHA-256 digest and returns the raw API token once', async () => {
    const { provider, tokenModel } = createProvider();

    const created = await provider.createAPIToken('  deploy bot  ');

    expect(created.token).toBe('raw.jwt.token');
    expect(created.name).toBe('deploy bot');
    expect(tokenModel.create).toHaveBeenCalledTimes(1);
    const stored = tokenModel.create.mock.calls[0][0];
    expect(stored.tokenHash).toBe(hashToken('raw.jwt.token'));
    expect(stored).not.toHaveProperty('token');
    expect(stored.userId).toBe(API_TOKEN_USER_ID);
    expect(stored.expiresIn).toBe(90 * 24 * 60 * 60);
  });

  it('rejects API-token lifetimes over 90 days before signing or writing', async () => {
    const { provider, tokenModel, jwtService } = createProvider();

    await expect(provider.createAPIToken('deploy bot', 91)).rejects.toThrow('between 1 and 90');
    expect(jwtService.sign).not.toHaveBeenCalled();
    expect(tokenModel.create).not.toHaveBeenCalled();
  });

  it('lists API-token metadata with an inclusion projection that omits secrets', async () => {
    const listed = [{ _id: 'id', name: 'deploy bot', createdAt: new Date() }];
    const query = queryResult(listed);
    const { provider, tokenModel } = createProvider({ find: jest.fn(() => query) });

    await expect(provider.getAllAPIToken()).resolves.toBe(listed);
    expect(tokenModel.find).toHaveBeenCalledWith(
      { userId: API_TOKEN_USER_ID, disabled: false },
      { _id: 1, name: 1, createdAt: 1 },
    );
  });

  it('validates a legacy plaintext token and opportunistically replaces it with a digest', async () => {
    const legacy = {
      _id: 'legacy-id',
      token: 'legacy.raw.token',
      createdAt: new Date(),
      expiresIn: 3600,
    };
    const findOne = jest
      .fn()
      .mockReturnValueOnce(queryResult(null))
      .mockReturnValueOnce(queryResult(legacy));
    const { provider, tokenModel } = createProvider({ findOne });

    await expect(provider.checkToken('legacy.raw.token')).resolves.toBe(true);
    expect(findOne.mock.calls[0][0]).toEqual({
      tokenHash: hashToken('legacy.raw.token'),
      disabled: false,
    });
    expect(tokenModel.updateOne).toHaveBeenCalledWith(
      { _id: 'legacy-id', token: 'legacy.raw.token' },
      expect.objectContaining({
        $set: expect.objectContaining({ tokenHash: hashToken('legacy.raw.token') }),
        $unset: { token: 1 },
      }),
    );
  });

  it('disables a legacy API token by id while removing its plaintext value', async () => {
    const legacy = {
      _id: 'legacy-id',
      token: 'legacy.raw.token',
      createdAt: new Date(),
      expiresIn: 3600,
    };
    const { provider, tokenModel } = createProvider({
      findOne: jest.fn(() => queryResult(legacy)),
    });

    await provider.disableAPITokenById('legacy-id');

    expect(tokenModel.updateOne).toHaveBeenCalledWith(
      { _id: 'legacy-id' },
      expect.objectContaining({
        $set: expect.objectContaining({
          disabled: true,
          tokenHash: hashToken('legacy.raw.token'),
        }),
        $unset: { token: 1 },
      }),
    );
  });
});
