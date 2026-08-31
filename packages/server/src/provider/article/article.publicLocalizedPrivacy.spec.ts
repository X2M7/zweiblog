import { ArticleProvider } from './article.provider';

const queryResult = (value: any) => {
  const query: any = {};
  query.exec = jest.fn().mockResolvedValue(value);
  query.select = jest.fn(() => query);
  query.sort = jest.fn(() => query);
  query.skip = jest.fn(() => query);
  query.limit = jest.fn(() => query);
  query.maxTimeMS = jest.fn(() => query);
  query.lean = jest.fn(() => query);
  query.then = (resolve: (result: any) => any, reject: (error: unknown) => any) =>
    Promise.resolve(value).then(resolve, reject);
  return query;
};

const makeProvider = () => {
  const articleModel: any = {
    find: jest.fn().mockReturnValue(queryResult([])),
    findOne: jest.fn().mockReturnValue(queryResult(null)),
    count: jest.fn().mockReturnValue(queryResult(0)),
  };
  const categoryModel: any = {
    find: jest.fn().mockReturnValue(queryResult([])),
    findOne: jest.fn().mockReturnValue(queryResult(null)),
  };
  const metaProvider: any = {
    getSiteInfo: jest.fn().mockResolvedValue({ allowOpenHiddenPostByUrl: true }),
  };
  const provider = new ArticleProvider(articleModel, categoryModel, metaProvider, {} as any);
  return { provider, articleModel, categoryModel };
};

const protectedArticle = {
  id: 7,
  title: '私密文章',
  titleEn: 'Private article',
  content: '私密正文',
  contentEn: 'Private body',
  summary: '私密摘要',
  summaryEn: 'Private summary',
  category: 'locked',
  tags: ['secret'],
  hidden: false,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('ArticleProvider public localized privacy', () => {
  it('derives a body-free English marker for every generic list query', async () => {
    const { provider, articleModel } = makeProvider();
    articleModel.find.mockReturnValue(
      queryResult([{ ...protectedArticle, private: false, category: 'public' }]),
    );

    const result = await provider.getAll('list', false);

    expect(articleModel.find.mock.calls[0][1]).toMatchObject({ titleEn: 1, contentEn: 1 });
    expect(result[0]).toMatchObject({ titleEn: 'Private article', hasEnglishVersion: true });
    expect(result[0]).not.toHaveProperty('content');
    expect(result[0]).not.toHaveProperty('contentEn');
    expect(result[0]).not.toHaveProperty('summary');
    expect(result[0]).not.toHaveProperty('summaryEn');
  });

  it('keeps the legacy public tag-list filter body-free and preserves the marker', () => {
    const { provider } = makeProvider();

    const result = provider.toPublic([{ ...protectedArticle, private: false } as any]);

    expect(result[0]).toMatchObject({
      titleEn: 'Private article',
      hasEnglishVersion: true,
    });
    expect(result[0]).not.toHaveProperty('content');
    expect(result[0]).not.toHaveProperty('contentEn');
    expect(result[0]).not.toHaveProperty('summary');
    expect(result[0]).not.toHaveProperty('summaryEn');
  });

  it('derives the same body-free marker for timeline responses', async () => {
    const { provider, articleModel } = makeProvider();
    articleModel.find.mockReturnValue(
      queryResult([{ ...protectedArticle, private: false, category: 'public' }]),
    );

    const result = await provider.getTimeLineInfo();

    expect(articleModel.find.mock.calls[0][1]).toMatchObject({ titleEn: 1, contentEn: 1 });
    expect(result['2026'][0]).toMatchObject({
      titleEn: 'Private article',
      hasEnglishVersion: true,
    });
    expect(result['2026'][0]).not.toHaveProperty('contentEn');
  });

  it('keeps list-option responses body-free while exposing translation completeness', async () => {
    const { provider, articleModel, categoryModel } = makeProvider();
    articleModel.find.mockReturnValue(
      queryResult([{ ...protectedArticle, private: false, category: 'public' }]),
    );
    articleModel.count.mockReturnValue(queryResult(1));
    categoryModel.find.mockReturnValue(queryResult([]));

    const result = await provider.getByOption(
      { page: 1, pageSize: -1, toListView: true } as any,
      true,
    );

    expect(articleModel.find.mock.calls[0][1]).toMatchObject({ titleEn: 1, contentEn: 1 });
    expect(result.articles[0]).toMatchObject({ hasEnglishVersion: true });
    expect(result.articles[0]).not.toHaveProperty('content');
    expect(result.articles[0]).not.toHaveProperty('contentEn');
    expect(result.articles[0]).not.toHaveProperty('summary');
    expect(result.articles[0]).not.toHaveProperty('summaryEn');
  });

  it('removes localized bodies and summaries from protected public list results', async () => {
    const { provider, articleModel, categoryModel } = makeProvider();
    const article = { ...protectedArticle, private: false };
    articleModel.find.mockReturnValue(queryResult([article]));
    articleModel.count.mockReturnValue(queryResult(1));
    categoryModel.find.mockReturnValue(queryResult([{ name: 'locked' }]));

    const result = await provider.getByOption({ page: 1, pageSize: 5 } as any, true);

    expect(result.articles).toHaveLength(1);
    expect(result.articles[0]).toMatchObject({ id: 7, private: true });
    expect(result.articles[0]).not.toHaveProperty('content');
    expect(result.articles[0]).not.toHaveProperty('contentEn');
    expect(result.articles[0]).not.toHaveProperty('summary');
    expect(result.articles[0]).not.toHaveProperty('summaryEn');
  });

  it.each([
    ['article privacy', { ...protectedArticle, private: true }, null],
    ['category privacy', { ...protectedArticle, private: false }, { private: true }],
  ])(
    'redacts localized summaries in detail responses protected by %s',
    async (_, article, category) => {
      const { provider, categoryModel } = makeProvider();
      jest.spyOn(provider, 'getByIdOrPathname').mockResolvedValue(article as any);
      jest.spyOn(provider, 'getPreArticleByArticle').mockResolvedValue(null);
      jest.spyOn(provider, 'getNextArticleByArticle').mockResolvedValue(null);
      categoryModel.findOne.mockReturnValue(queryResult(category));

      const result = await provider.getByIdOrPathnameWithPreNext(7, 'public');

      expect(result.article).toMatchObject({ id: 7, private: true, hasEnglishVersion: true });
      expect(result.article).not.toHaveProperty('content');
      expect(result.article).not.toHaveProperty('contentEn');
      expect(result.article).not.toHaveProperty('summary');
      expect(result.article).not.toHaveProperty('summaryEn');
    },
  );

  it('excludes private articles and private-category articles from localized search', async () => {
    const { provider, articleModel, categoryModel } = makeProvider();
    const publicArticle = {
      ...protectedArticle,
      id: 1,
      title: '公开文章',
      content: 'needle in public content',
      category: 'public',
      private: false,
    };
    articleModel.find.mockReturnValue(
      queryResult([
        publicArticle,
        { ...protectedArticle, id: 2, private: true, category: 'public' },
        { ...protectedArticle, id: 3, private: false, category: 'locked' },
      ]),
    );
    categoryModel.find.mockReturnValue(queryResult([{ name: 'locked' }]));

    const result = await provider.searchByString('needle', false);

    expect(result).toEqual([publicArticle]);
    const filter = articleModel.find.mock.calls[0][0];
    expect(filter.$and).toContainEqual({
      $or: [{ private: false }, { private: { $exists: false } }],
    });
    expect(filter.$and).toContainEqual({ category: { $nin: ['locked'] } });
  });

  it.each([
    ['complete English content', 'English title', 'English body', true],
    ['missing English body', 'English title', '   ', false],
    ['missing English title', '   ', 'English body', false],
  ])(
    'returns body-free neighbors with a reliable marker for %s',
    async (_, titleEn, contentEn, expected) => {
      const { provider, articleModel } = makeProvider();
      articleModel.find.mockReturnValue(
        queryResult([
          {
            ...protectedArticle,
            titleEn,
            contentEn,
            private: false,
          },
        ]),
      );

      const result = await provider.getPreArticleByArticle(
        { createdAt: new Date('2026-02-01T00:00:00.000Z') } as any,
        'list',
      );

      expect(result).toMatchObject({ id: 7, titleEn, hasEnglishVersion: expected });
      expect(result).not.toHaveProperty('content');
      expect(result).not.toHaveProperty('contentEn');
      expect(result).not.toHaveProperty('summary');
      expect(result).not.toHaveProperty('summaryEn');
      const projection = articleModel.find.mock.calls[0][1];
      expect(projection).toMatchObject({ titleEn: 1, contentEn: 1 });
      expect(projection).not.toHaveProperty('content');
      expect(projection).not.toHaveProperty('summary');
      expect(projection).not.toHaveProperty('summaryEn');
    },
  );
});
