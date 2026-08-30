import { CategoryProvider } from './category.provider';
import { isScryptPasswordHash } from 'src/utils/crypto';

const queryResult = (value: any) => {
  const query: any = { exec: jest.fn().mockResolvedValue(value) };
  query.select = jest.fn(() => query);
  query.lean = jest.fn(() => query);
  return query;
};

const makeProvider = (existing: any = { name: 'notes', private: false, password: '' }) => {
  const categoryModel: any = {
    find: jest.fn().mockReturnValue(queryResult([])),
    findOne: jest.fn().mockReturnValue(queryResult(existing)),
    updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
    create: jest.fn().mockResolvedValue({}),
  };
  const articleProvider: any = { getAll: jest.fn(), updateById: jest.fn() };
  return {
    provider: new CategoryProvider(categoryModel, articleProvider),
    categoryModel,
  };
};

describe('CategoryProvider content password security', () => {
  it('redacts stored passwords from detailed admin responses', async () => {
    const { provider, categoryModel } = makeProvider();
    categoryModel.find.mockReturnValue(
      queryResult([
        {
          toObject: () => ({
            _id: 'mongo-id',
            __v: 0,
            id: 1,
            name: 'notes',
            private: true,
            password: 'scrypt$v1$sensitive',
          }),
        },
      ]),
    );

    await expect(provider.getAllCategories(true)).resolves.toEqual([
      { id: 1, name: 'notes', private: true, hasPassword: true },
    ]);
  });

  it('includes password hashes only in the dedicated backup export', async () => {
    const { provider, categoryModel } = makeProvider();
    categoryModel.find.mockReturnValue(
      queryResult([
        {
          _id: 'mongo-id',
          __v: 0,
          id: 1,
          name: 'notes',
          private: true,
          password: 'scrypt$v1$backup',
        },
      ]),
    );

    await expect(provider.exportForBackup()).resolves.toEqual([
      {
        id: 1,
        name: 'notes',
        private: true,
        password: 'scrypt$v1$backup',
      },
    ]);
  });

  it('requires a password when category privacy is enabled', async () => {
    const { provider } = makeProvider();
    await expect(provider.updateCategoryByName('notes', { private: true })).rejects.toThrow(
      'Private categories require a password',
    );
  });

  it('hashes a new password and preserves an existing one on blank edits', async () => {
    const { provider, categoryModel } = makeProvider();
    await provider.updateCategoryByName('notes', { private: true, password: 'secret' });
    expect(isScryptPasswordHash(categoryModel.updateOne.mock.calls[0][1].$set.password)).toBe(true);

    const withPassword = makeProvider({
      name: 'notes',
      private: true,
      password: 'scrypt$v1$existing',
    });
    await withPassword.provider.updateCategoryByName('notes', { private: true, password: '' });
    expect(withPassword.categoryModel.updateOne.mock.calls[0][1].$set.password).toBeUndefined();
    expect(withPassword.categoryModel.updateOne.mock.calls[0][1].$unset).toBeUndefined();
  });

  it('removes the stored password when privacy is disabled', async () => {
    const { provider, categoryModel } = makeProvider({
      name: 'notes',
      private: true,
      password: 'legacy-secret',
    });
    await provider.updateCategoryByName('notes', { private: false });
    expect(categoryModel.updateOne.mock.calls[0][1].$unset).toEqual({ password: 1 });
  });

  it('round-trips trusted backup hashes and hashes legacy plaintext', async () => {
    const backupHash = 'scrypt$v1$32768$8$1$c2FsdA==$aGFzaA==';
    const trusted = makeProvider({ _id: 'notes-id', name: 'notes', private: false });
    await trusted.provider.importFromBackup([
      { name: 'notes', private: true, password: backupHash },
    ]);
    expect(trusted.categoryModel.updateOne.mock.calls[0][1].$set.password).toBe(backupHash);

    const legacy = makeProvider({ _id: 'notes-id', name: 'notes', private: false });
    await legacy.provider.importFromBackup([
      { name: 'notes', private: true, password: 'legacy-secret' },
    ]);
    const migrated = legacy.categoryModel.updateOne.mock.calls[0][1].$set.password;
    expect(migrated).not.toBe('legacy-secret');
    expect(isScryptPasswordHash(migrated)).toBe(true);
  });
});
