import { TagProvider } from './tag.provider';

const queryResult = (value: any) => {
  const query: any = { exec: jest.fn().mockResolvedValue(value) };
  query.lean = jest.fn(() => query);
  return query;
};

const makeProvider = () => {
  const articleProvider: any = {
    getAll: jest.fn().mockResolvedValue([
      { id: 1, tags: ['中文标签', 'shared'] },
      { id: 2, tags: ['shared'] },
    ]),
    updateById: jest.fn().mockResolvedValue(undefined),
  };
  const tagModel: any = {
    find: jest.fn().mockReturnValue(queryResult([{ name: '中文标签', nameEn: 'Chinese tag' }])),
    findOne: jest.fn().mockReturnValue(queryResult(null)),
    updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
    deleteOne: jest.fn().mockReturnValue(queryResult({ acknowledged: true })),
  };
  return { provider: new TagProvider(articleProvider, tagModel), articleProvider, tagModel };
};

describe('TagProvider localized metadata', () => {
  it('keeps the legacy string list and exposes additive details', async () => {
    const { provider } = makeProvider();
    await expect(provider.getAllTags(true)).resolves.toEqual(
      expect.arrayContaining(['shared', '中文标签']),
    );
    const details = await provider.getTagDetails(true);
    expect(details).toEqual(
      expect.arrayContaining([
        { name: 'shared', nameEn: '' },
        { name: '中文标签', nameEn: 'Chinese tag' },
      ]),
    );
  });

  it('updates a translation without rewriting article tag identities', async () => {
    const { provider, articleProvider, tagModel } = makeProvider();
    await provider.updateTagByName('中文标签', { nameEn: 'Translated tag' });

    expect(articleProvider.updateById).not.toHaveBeenCalled();
    expect(tagModel.updateOne).toHaveBeenCalledWith(
      { name: '中文标签' },
      { $set: { name: '中文标签', nameEn: 'Translated tag' } },
      { upsert: true },
    );
  });

  it('accepts both legacy string and localized tag backups', async () => {
    const { provider, tagModel } = makeProvider();
    await provider.importFromBackup(['legacy', { name: '中文标签', nameEn: 'Chinese tag' }]);
    expect(tagModel.updateOne).toHaveBeenCalledTimes(2);
    expect(tagModel.updateOne.mock.calls[0][1].$set).not.toHaveProperty('nameEn');
    expect(tagModel.updateOne.mock.calls[1][1].$set.nameEn).toBe('Chinese tag');
  });
});
