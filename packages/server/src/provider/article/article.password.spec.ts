import { ArticleProvider } from './article.provider';
import { isScryptPasswordHash } from 'src/utils/crypto';

const queryResult = (value: any) => {
  const query: any = { exec: jest.fn().mockResolvedValue(value) };
  query.select = jest.fn(() => query);
  query.sort = jest.fn(() => query);
  return query;
};

const makeProvider = () => {
  const savedDocuments: any[] = [];
  const articleModel: any = jest.fn().mockImplementation((data: any) => {
    const document: any = { ...data };
    document.save = jest.fn(async () => {
      savedDocuments.push(document);
      return { toObject: () => ({ ...document }) };
    });
    return document;
  });
  articleModel.findOne = jest.fn().mockReturnValue(queryResult(null));
  articleModel.find = jest.fn().mockReturnValue(queryResult([]));
  articleModel.updateOne = jest.fn().mockResolvedValue({ acknowledged: true });

  const categoryModel: any = {
    findOne: jest.fn().mockReturnValue(queryResult(null)),
    updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
  };
  const metaProvider: any = {
    updateTotalWords: jest.fn(),
    getSiteInfo: jest.fn().mockResolvedValue({ allowOpenHiddenPostByUrl: true }),
  };
  const visitProvider: any = {};
  const provider = new ArticleProvider(articleModel, categoryModel, metaProvider, visitProvider);
  return { provider, articleModel, categoryModel, metaProvider, savedDocuments };
};

describe('ArticleProvider content password security', () => {
  it('hashes a new private article password and never returns the hash', async () => {
    const { provider, savedDocuments } = makeProvider();

    const result: any = await provider.create(
      { title: 'private', category: 'notes', private: true, password: 'secret' },
      true,
      42,
    );

    expect(isScryptPasswordHash(savedDocuments[0].password)).toBe(true);
    expect(savedDocuments[0].password).not.toBe('secret');
    expect(result.password).toBeUndefined();
    expect(result.id).toBe(42);
  });

  it('includes the hash only in the dedicated backup export', async () => {
    const { provider, articleModel } = makeProvider();
    const rows = [{ id: 42, password: 'scrypt$v1$backup' }];
    const query = queryResult(rows);
    articleModel.find.mockReturnValue(query);

    await expect(provider.exportForBackup()).resolves.toBe(rows);
    expect(articleModel.find.mock.calls[0][1]).toMatchObject({ password: 1 });
    expect(query.select).toHaveBeenCalledWith('+password');
  });

  it('requires a password when a private article is created', async () => {
    const { provider } = makeProvider();
    await expect(
      provider.create({ title: 'private', category: 'notes', private: true }, true, 42),
    ).rejects.toThrow('Private articles require a password');
  });

  it('preserves a scrypt hash only on the trusted backup import path', async () => {
    const { provider, articleModel, savedDocuments } = makeProvider();
    const backupHash = 'scrypt$v1$32768$8$1$c2FsdA==$aGFzaA==';

    await provider.create(
      { title: 'backup', category: 'notes', private: true, password: backupHash },
      true,
      42,
      true,
    );
    await provider.create(
      { title: 'normal', category: 'notes', private: true, password: backupHash },
      true,
      43,
    );

    expect(savedDocuments[0].password).toBe(backupHash);
    expect(savedDocuments[1].password).not.toBe(backupHash);
    expect(isScryptPasswordHash(savedDocuments[1].password)).toBe(true);

    articleModel.findOne.mockReturnValue(queryResult({ private: true, password: 'old' }));
    await provider.updateById(42, { private: true, password: backupHash }, true, true);
    expect(articleModel.updateOne.mock.calls[0][1].$set.password).toBe(backupHash);
  });

  it('preserves an existing password on blank edits and removes it when privacy is disabled', async () => {
    const { provider, articleModel } = makeProvider();
    articleModel.findOne.mockReturnValue(
      queryResult({ private: true, password: 'scrypt$v1$existing' }),
    );

    await provider.updateById(7, { title: 'renamed', password: '' }, true);
    expect(articleModel.updateOne.mock.calls[0][1].$set.password).toBeUndefined();
    expect(articleModel.updateOne.mock.calls[0][1].$unset).toBeUndefined();

    await provider.updateById(7, { private: false, password: 'ignored' }, true);
    expect(articleModel.updateOne.mock.calls[1][1].$set.password).toBeUndefined();
    expect(articleModel.updateOne.mock.calls[1][1].$unset).toEqual({ password: 1 });
  });

  it('migrates a verified legacy plaintext article password and redacts the response', async () => {
    const { provider, articleModel } = makeProvider();
    const article = {
      _id: 'article-object-id',
      id: 7,
      title: 'legacy',
      category: 'notes',
      private: true,
      password: 'legacy-secret',
      deleted: false,
      toObject() {
        return { ...this, toObject: undefined };
      },
    };
    articleModel.findOne.mockReturnValue(queryResult(article));

    const result: any = await provider.getByIdWithPassword('7', 'legacy-secret');

    const update = articleModel.updateOne.mock.calls[0];
    expect(update[0]).toEqual({ _id: 'article-object-id' });
    expect(isScryptPasswordHash(update[1].$set.password)).toBe(true);
    expect(result.password).toBeUndefined();
    expect(result._id).toBeUndefined();
    expect(result.deleted).toBeUndefined();
  });

  it('uses and migrates a private category password before the article password', async () => {
    const { provider, articleModel, categoryModel } = makeProvider();
    articleModel.findOne.mockReturnValue(
      queryResult({
        _id: 'article-id',
        id: 7,
        category: 'locked',
        private: true,
        password: 'article-secret',
        toObject() {
          return { ...this, toObject: undefined };
        },
      }),
    );
    categoryModel.findOne.mockReturnValue(
      queryResult({
        _id: 'category-id',
        name: 'locked',
        private: true,
        password: 'category-secret',
      }),
    );

    await expect(provider.getByIdWithPassword('7', 'article-secret')).resolves.toBeNull();
    const result = await provider.getByIdWithPassword('7', 'category-secret');

    expect(result).not.toBeNull();
    expect(categoryModel.updateOne).toHaveBeenCalledWith(
      { _id: 'category-id' },
      { $set: { password: expect.stringMatching(/^scrypt\$v1\$/) } },
    );
    expect(articleModel.updateOne).not.toHaveBeenCalled();
  });

  it('applies the hidden-article policy before checking a password', async () => {
    const { provider, articleModel, categoryModel, metaProvider } = makeProvider();
    articleModel.findOne.mockReturnValue(
      queryResult({
        _id: 'hidden-id',
        id: 9,
        category: 'notes',
        hidden: true,
        private: true,
        password: 'legacy-secret',
      }),
    );
    metaProvider.getSiteInfo.mockResolvedValue({ allowOpenHiddenPostByUrl: false });

    await expect(provider.getByIdWithPassword('9', 'legacy-secret')).rejects.toThrow(
      '该文章是隐藏文章',
    );
    expect(categoryModel.findOne).not.toHaveBeenCalled();
    expect(articleModel.updateOne).not.toHaveBeenCalled();
  });
});
