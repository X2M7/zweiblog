import { BadRequestException } from '@nestjs/common';
import { encryptLegacyPassword, encryptPassword, makeSalt } from 'src/utils/crypto';
import { UserProvider } from './user.provider';

const queryResult = (value: unknown) => {
  const query: any = { exec: jest.fn().mockResolvedValue(value) };
  query.lean = jest.fn(() => query);
  return query;
};

const makeProvider = () => {
  const userModel: any = {
    findOne: jest.fn(),
    updateOne: jest.fn(() => queryResult({ acknowledged: true })),
  };
  return { provider: new UserProvider(userModel), userModel };
};

describe('UserProvider backup credentials', () => {
  it('exports only the credential envelope and restores a scrypt digest unchanged', async () => {
    const salt = makeSalt();
    const password = await encryptPassword('admin', 'correct horse battery staple', salt);
    const stored = {
      _id: 'mongo-id',
      __v: 4,
      id: 0,
      type: 'admin',
      name: 'admin',
      nickname: 'Site owner',
      password,
      salt,
    };
    const { provider, userModel } = makeProvider();
    userModel.findOne
      .mockReturnValueOnce(queryResult(stored))
      .mockReturnValueOnce(queryResult({ _id: 'current-admin' }));

    const backup = await provider.exportForBackup();
    expect(backup).toEqual({
      version: 1,
      id: 0,
      type: 'admin',
      name: 'admin',
      nickname: 'Site owner',
      password,
      salt,
    });
    expect(userModel.findOne.mock.calls[0][1]).toEqual({
      _id: 0,
      id: 1,
      type: 1,
      name: 1,
      nickname: 1,
      password: 1,
      salt: 1,
    });

    await provider.importFromBackup(backup);
    const update = userModel.updateOne.mock.calls[0][1];
    expect(update.$set.password).toBe(password);
    expect(update.$set.salt).toBe(salt);
    expect(update.$set.password).not.toContain('correct horse battery staple');
  });

  it('preserves a valid legacy SHA-256 digest and salt for login-time migration', async () => {
    const salt = makeSalt();
    const password = encryptLegacyPassword('legacy-admin', 'browser-password', salt);
    const { provider, userModel } = makeProvider();
    userModel.findOne.mockReturnValue(queryResult({ _id: 'current-admin' }));

    await provider.importFromBackup({
      id: 0,
      type: 'admin',
      name: 'legacy-admin',
      password,
      salt,
      _id: 'old-backup-id',
      __v: 1,
    });

    expect(userModel.updateOne.mock.calls[0][1].$set).toEqual({
      name: 'legacy-admin',
      password,
      salt,
      type: 'admin',
    });
  });

  it.each([
    ['missing password', { name: 'admin', salt: makeSalt() }],
    [
      'malformed scrypt digest',
      { name: 'admin', password: 'scrypt$v1$32768$8$1$bad$bad', salt: makeSalt() },
    ],
    [
      'operator injection',
      {
        name: { $ne: null },
        password: { $ne: null },
        salt: makeSalt(),
        $set: { type: 'collaborator' },
      },
    ],
    [
      'unexpected field',
      {
        name: 'admin',
        password: 'a'.repeat(64),
        salt: makeSalt(),
        role: 'superuser',
      },
    ],
  ])('rejects %s without updating the administrator', async (_label, input) => {
    const { provider, userModel } = makeProvider();

    await expect(provider.importFromBackup(input)).rejects.toBeInstanceOf(BadRequestException);
    expect(userModel.findOne).not.toHaveBeenCalled();
    expect(userModel.updateOne).not.toHaveBeenCalled();
  });
});
