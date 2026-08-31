import { ArticleProvider } from './article.provider';

const queryResult = (value: any) => {
  const query: any = { exec: jest.fn().mockResolvedValue(value) };
  query.select = jest.fn(() => query);
  query.sort = jest.fn(() => query);
  query.limit = jest.fn(() => query);
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

  const categoryModel: any = { findOne: jest.fn().mockReturnValue(queryResult(null)) };
  const metaProvider: any = {
    updateTotalWords: jest.fn(),
    getSiteInfo: jest.fn().mockResolvedValue({ allowOpenHiddenPostByUrl: true }),
  };
  const provider = new ArticleProvider(articleModel, categoryModel, metaProvider, {} as any);
  return { provider, articleModel, savedDocuments };
};

describe('ArticleProvider bilingual article support', () => {
  const localized = {
    titleEn: 'English title',
    contentEn: '# English body',
    summary: '中文摘要',
    summaryEn: 'English summary',
  };

  it('persists localized fields and exposes them through explicit public/admin projections', async () => {
    const { provider, savedDocuments } = makeProvider();

    await provider.create(
      { title: '中文标题', content: '正文', category: 'notes', ...localized },
      true,
      7,
    );

    expect(savedDocuments[0]).toMatchObject(localized);
    expect(provider.publicView).toMatchObject({
      titleEn: 1,
      contentEn: 1,
      summary: 1,
      summaryEn: 1,
    });
    expect(provider.adminView).toMatchObject({
      titleEn: 1,
      contentEn: 1,
      summary: 1,
      summaryEn: 1,
    });
    expect(provider.listView).toMatchObject({ titleEn: 1 });
    expect(provider.listView).not.toHaveProperty('contentEn');
    expect(provider.listView).not.toHaveProperty('summary');
    expect(provider.listView).not.toHaveProperty('summaryEn');
  });

  it('keeps both bodies hidden when an article requires a password', async () => {
    const { provider } = makeProvider();
    const article: any = {
      id: 7,
      private: true,
      hidden: false,
      titleEn: 'English title',
      content: 'secret zh',
      contentEn: 'secret en',
      summary: 'secret summary zh',
      summaryEn: 'secret summary en',
      createdAt: new Date(),
    };
    jest.spyOn(provider, 'getByIdOrPathname').mockResolvedValue(article);
    jest.spyOn(provider, 'getPreArticleByArticle').mockResolvedValue(null);
    jest.spyOn(provider, 'getNextArticleByArticle').mockResolvedValue(null);

    const result = await provider.getByIdOrPathnameWithPreNext(7, 'public');

    expect(result.article.content).toBeUndefined();
    expect(result.article.contentEn).toBeUndefined();
    expect(result.article.summary).toBeUndefined();
    expect(result.article.summaryEn).toBeUndefined();
    expect(result.article.hasEnglishVersion).toBe(true);
  });

  it('includes localized fields in the dedicated backup projection', async () => {
    const { provider, articleModel } = makeProvider();

    await provider.exportForBackup();

    expect(articleModel.find.mock.calls[0][1]).toMatchObject({
      titleEn: 1,
      contentEn: 1,
      summary: 1,
      summaryEn: 1,
      password: 1,
    });
  });

  it('restores localized backups and accepts legacy records without the new fields', async () => {
    const localizedBackup = makeProvider();
    await localizedBackup.provider.importArticles([
      {
        id: 7,
        title: '中文标题',
        content: '中文正文',
        category: 'notes',
        ...localized,
      } as any,
    ]);
    expect(localizedBackup.savedDocuments[0]).toMatchObject({ id: 7, ...localized });

    const legacyBackup = makeProvider();
    await expect(
      legacyBackup.provider.importArticles([
        { id: 8, title: '旧文章', content: '旧正文', category: 'notes' } as any,
      ]),
    ).resolves.toBeUndefined();
    expect(legacyBackup.savedDocuments[0]).toMatchObject({ id: 8, title: '旧文章' });
  });

  it('returns localized list metadata without exposing article bodies', () => {
    const { provider } = makeProvider();
    expect(
      provider.toPublic([
        {
          id: 7,
          title: '中文标题',
          content: '中文正文',
          category: 'notes',
          tags: [],
          top: 0,
          ...localized,
        } as any,
      ])[0],
    ).toMatchObject({
      title: '中文标题',
      titleEn: localized.titleEn,
      hasEnglishVersion: true,
    });
    const [result] = provider.toPublic([
      {
        id: 7,
        title: '中文标题',
        content: '中文正文',
        category: 'notes',
        tags: [],
        top: 0,
        ...localized,
      } as any,
    ]);
    expect(result).not.toHaveProperty('content');
    expect(result).not.toHaveProperty('contentEn');
    expect(result).not.toHaveProperty('summary');
    expect(result).not.toHaveProperty('summaryEn');
  });

  it('marks complete English search results without exposing either article body', () => {
    const { provider } = makeProvider();
    const [complete, incomplete] = provider.toSearchResult([
      {
        id: 7,
        title: '中文标题',
        titleEn: 'English title',
        content: '中文正文',
        contentEn: 'English body',
      } as any,
      {
        id: 8,
        title: '另一篇文章',
        titleEn: 'Title without a body',
        content: '中文正文',
        contentEn: '',
      } as any,
    ]);

    expect(complete).toMatchObject({ titleEn: 'English title', hasEnglishVersion: true });
    expect(incomplete).toMatchObject({ hasEnglishVersion: false });
    expect(complete).not.toHaveProperty('content');
    expect(complete).not.toHaveProperty('contentEn');
  });
});
