import { BadRequestException } from '@nestjs/common';
import { ArticleProvider } from './article.provider';

const queryResult = (value: any) => {
  const query: any = { exec: jest.fn().mockResolvedValue(value) };
  query.select = jest.fn(() => query);
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
  articleModel.updateOne = jest.fn().mockResolvedValue({ acknowledged: true });

  const categoryModel: any = {};
  const metaProvider: any = { updateTotalWords: jest.fn() };
  const visitProvider: any = {};
  const provider = new ArticleProvider(articleModel, categoryModel, metaProvider, visitProvider);

  return { provider, articleModel, metaProvider, savedDocuments };
};

describe('ArticleProvider article identity hardening', () => {
  it.each([
    ['id', 8],
    ['_id', 'replacement-object-id'],
    ['__v', 4],
  ])('rejects the body-supplied %s field when creating an article', async (field, value) => {
    const { provider, articleModel } = makeProvider();

    await expect(
      provider.create({ title: 'new', category: 'notes', [field]: value } as any, true, 7),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(articleModel.findOne).not.toHaveBeenCalled();
    expect(articleModel).not.toHaveBeenCalled();
  });

  it('rejects a duplicate pathname when creating an article', async () => {
    const { provider, articleModel } = makeProvider();
    articleModel.findOne.mockReturnValueOnce(queryResult({ id: 9 }));

    await expect(
      provider.create({ title: 'new', category: 'notes', pathname: 'already-taken' }, true, 7),
    ).rejects.toThrow('Article pathname conflicts with another article');

    expect(articleModel.findOne).toHaveBeenCalledWith(
      {
        id: { $ne: 7 },
        $or: [{ pathname: 'already-taken' }, { pathname: '7' }],
      },
      { id: 1, _id: 0 },
    );
    expect(articleModel).not.toHaveBeenCalled();
  });

  it('rejects a numeric create pathname that would shadow another stable article id', async () => {
    const { provider, articleModel } = makeProvider();
    articleModel.findOne.mockReturnValueOnce(queryResult({ id: 42 }));

    await expect(
      provider.create({ title: 'new', category: 'notes', pathname: '42' }, true, 7),
    ).rejects.toThrow('Article pathname conflicts with another article');

    expect(articleModel.findOne).toHaveBeenCalledWith(
      {
        id: { $ne: 7 },
        $or: [{ pathname: '42' }, { pathname: '7' }, { id: 42 }],
      },
      { id: 1, _id: 0 },
    );
  });

  it("rejects creation when an existing pathname shadows the new article's explicit id", async () => {
    const { provider, articleModel } = makeProvider();
    articleModel.findOne.mockReturnValueOnce(queryResult({ id: 5, pathname: '7' }));

    await expect(provider.create({ title: 'new', category: 'notes' }, true, 7)).rejects.toThrow(
      'Article pathname conflicts with another article',
    );

    expect(articleModel.findOne).toHaveBeenCalledWith(
      {
        id: { $ne: 7 },
        $or: [{ pathname: '7' }],
      },
      { id: 1, _id: 0 },
    );
  });

  it('uses the trusted backup id as the stable namespace and permits its matching pathname', async () => {
    const { provider, articleModel, savedDocuments } = makeProvider();

    await expect(
      provider.create({ title: 'restored', category: 'notes', pathname: '42' }, true, 42, true),
    ).resolves.toMatchObject({ id: 42, pathname: '42' });

    expect(articleModel.findOne).toHaveBeenCalledWith(
      {
        id: { $ne: 42 },
        $or: [{ pathname: '42' }, { id: 42 }],
      },
      { id: 1, _id: 0 },
    );
    expect(savedDocuments[0].id).toBe(42);
  });

  it('rejects an invalid explicit id from an untrusted backup record', async () => {
    const { provider, articleModel } = makeProvider();

    await expect(
      provider.create({ title: 'restored', category: 'notes' }, true, '7' as any, true),
    ).rejects.toThrow('Article id must be a positive safe integer');

    expect(articleModel.findOne).not.toHaveBeenCalled();
    expect(articleModel).not.toHaveBeenCalled();
  });

  it.each([
    '/nested',
    'back\\slash',
    'query?value',
    'fragment#value',
    'line\nbreak',
    '%2Fencoded-separator',
    '%252Fdouble-encoded-separator',
    '%E0%A4%A',
    '.',
    '..',
    'a'.repeat(257),
  ])('rejects an unsafe create pathname: %s', async (pathname) => {
    const { provider, articleModel } = makeProvider();

    await expect(
      provider.create({ title: 'new', category: 'notes', pathname }, true, 7),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(articleModel.findOne).not.toHaveBeenCalled();
    expect(articleModel).not.toHaveBeenCalled();
  });

  it('decodes, trims, and NFC-normalizes a create pathname before checking and saving it', async () => {
    const { provider, articleModel, savedDocuments } = makeProvider();

    await provider.create({ title: 'new', category: 'notes', pathname: ' cafe%CC%81 ' }, true, 7);

    expect(articleModel.findOne).toHaveBeenCalledWith(
      {
        id: { $ne: 7 },
        $or: [{ pathname: 'café' }, { pathname: 'café' }, { pathname: '7' }],
      },
      { id: 1, _id: 0 },
    );
    expect(savedDocuments[0].pathname).toBe('café');
    expect(savedDocuments[0].pathname).toBe(savedDocuments[0].pathname.normalize('NFC'));
  });

  it('allows a whitespace-only pathname as the empty numeric-id fallback', async () => {
    const { provider, savedDocuments } = makeProvider();

    await provider.create({ title: 'new', category: 'notes', pathname: '   ' }, true, 7);

    expect(savedDocuments[0].pathname).toBe('');
  });

  it('uses the same decoded NFC pathname for article route lookups', async () => {
    const { provider, articleModel } = makeProvider();
    articleModel.findOne.mockReturnValueOnce(queryResult({ id: 7, pathname: 'café' }));

    await expect(provider.getByPathName('cafe%CC%81', 'public')).resolves.toMatchObject({ id: 7 });

    expect(articleModel.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: 'café' }),
      provider.publicView,
    );
  });

  it('fails closed before querying an unsafe article route pathname', async () => {
    const { provider, articleModel } = makeProvider();

    await expect(provider.getByPathName('%2Funsafe', 'public')).resolves.toBeNull();

    expect(articleModel.findOne).not.toHaveBeenCalled();
  });

  it('serializes concurrent create checks through persistence on one server instance', async () => {
    const { provider, articleModel, savedDocuments } = makeProvider();
    let announceFirstSave: () => void = () => undefined;
    let releaseFirstSave: () => void = () => undefined;
    const firstSaveStarted = new Promise<void>((resolve) => {
      announceFirstSave = resolve;
    });
    const firstSaveGate = new Promise<void>((resolve) => {
      releaseFirstSave = resolve;
    });

    articleModel.mockImplementation((data: any) => {
      const document: any = { ...data };
      document.save = jest.fn(async () => {
        if (document.id === 7) {
          announceFirstSave();
          await firstSaveGate;
        }
        savedDocuments.push(document);
        return { toObject: () => ({ ...document }) };
      });
      return document;
    });
    articleModel.findOne.mockImplementation((filter: any) => {
      const pathnameClaims = (filter.$or || [])
        .map((condition: any) => condition.pathname)
        .filter((pathname: unknown) => typeof pathname === 'string');
      const conflict = savedDocuments.find(
        (document) => document.id !== filter.id.$ne && pathnameClaims.includes(document.pathname),
      );
      return queryResult(conflict || null);
    });

    const first = provider.create(
      { title: 'first', category: 'notes', pathname: 'race-path' },
      true,
      7,
    );
    await firstSaveStarted;
    const second = provider.create(
      { title: 'second', category: 'notes', pathname: 'race-path' },
      true,
      8,
    );
    const secondResult = expect(second).rejects.toThrow(
      'Article pathname conflicts with another article',
    );

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(articleModel.findOne).toHaveBeenCalledTimes(1);

    releaseFirstSave();
    await expect(first).resolves.toMatchObject({ id: 7 });
    await secondResult;
    expect(savedDocuments).toHaveLength(1);
  });

  it.each([
    ['id', 8],
    ['_id', 'replacement-object-id'],
    ['__v', 4],
  ])('rejects the immutable %s field before issuing a database update', async (field, value) => {
    const { provider, articleModel } = makeProvider();

    await expect(
      provider.updateById(7, { title: 'renamed', [field]: value } as any, true),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(articleModel.findOne).not.toHaveBeenCalled();
    expect(articleModel.updateOne).not.toHaveBeenCalled();
  });

  it('rejects a changed pathname already owned by another article', async () => {
    const { provider, articleModel } = makeProvider();
    articleModel.findOne
      .mockReturnValueOnce(queryResult({ private: false, pathname: 'original' }))
      .mockReturnValueOnce(queryResult({ id: 9 }));

    await expect(provider.updateById(7, { pathname: 'already-taken' }, true)).rejects.toThrow(
      'Article pathname conflicts with another article',
    );

    expect(articleModel.findOne).toHaveBeenNthCalledWith(
      2,
      {
        id: { $ne: 7 },
        $or: [{ pathname: 'already-taken' }],
      },
      { id: 1, _id: 0 },
    );
    expect(articleModel.updateOne).not.toHaveBeenCalled();
  });

  it('rejects a numeric pathname that would shadow another stable article id', async () => {
    const { provider, articleModel } = makeProvider();
    articleModel.findOne
      .mockReturnValueOnce(queryResult({ private: false, pathname: 'original' }))
      .mockReturnValueOnce(queryResult({ id: 42 }));

    await expect(provider.updateById(7, { pathname: '42' }, true)).rejects.toThrow(
      'Article pathname conflicts with another article',
    );

    expect(articleModel.findOne).toHaveBeenNthCalledWith(
      2,
      {
        id: { $ne: 7 },
        $or: [{ pathname: '42' }, { id: 42 }],
      },
      { id: 1, _id: 0 },
    );
    expect(articleModel.updateOne).not.toHaveBeenCalled();
  });

  it('allows an unchanged legacy pathname without scanning or freezing old duplicate data', async () => {
    const { provider, articleModel } = makeProvider();
    articleModel.findOne.mockReturnValueOnce(
      queryResult({ private: false, pathname: 'legacy-path' }),
    );

    await provider.updateById(7, { title: 'safe imported edit', pathname: 'legacy-path' }, true);

    expect(articleModel.findOne).toHaveBeenCalledTimes(1);
    expect(articleModel.updateOne).toHaveBeenCalledWith(
      { id: 7 },
      expect.objectContaining({
        $set: expect.objectContaining({
          title: 'safe imported edit',
          pathname: 'legacy-path',
        }),
      }),
    );
  });

  it('updates to an unused non-numeric pathname after the conflict check', async () => {
    const { provider, articleModel } = makeProvider();
    articleModel.findOne
      .mockReturnValueOnce(queryResult({ private: false, pathname: 'old-path' }))
      .mockReturnValueOnce(queryResult(null));

    await expect(
      provider.updateById(7, { pathname: 'new-path', title: 'renamed' }, true),
    ).resolves.toEqual({ acknowledged: true });

    expect(articleModel.updateOne).toHaveBeenCalledWith(
      { id: 7 },
      expect.objectContaining({
        $set: expect.objectContaining({ pathname: 'new-path', title: 'renamed' }),
      }),
    );
  });

  it('rejects a non-string pathname before using it in a MongoDB query', async () => {
    const { provider, articleModel } = makeProvider();
    articleModel.findOne.mockReturnValueOnce(queryResult({ private: false, pathname: 'old-path' }));

    await expect(provider.updateById(7, { pathname: { $ne: '' } } as any, true)).rejects.toThrow(
      'Article pathname must be a string',
    );

    expect(articleModel.findOne).not.toHaveBeenCalled();
    expect(articleModel.updateOne).not.toHaveBeenCalled();
  });

  it.each([
    '/nested',
    'back\\slash',
    'query?value',
    'fragment#value',
    'tab\tvalue',
    'a'.repeat(257),
  ])('rejects an unsafe update pathname: %s', async (pathname) => {
    const { provider, articleModel } = makeProvider();

    await expect(provider.updateById(7, { pathname }, true)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(articleModel.findOne).not.toHaveBeenCalled();
    expect(articleModel.updateOne).not.toHaveBeenCalled();
  });

  it('stores the NFC pathname produced by an update', async () => {
    const { provider, articleModel } = makeProvider();
    articleModel.findOne
      .mockReturnValueOnce(queryResult({ private: false, pathname: 'old-path' }))
      .mockReturnValueOnce(queryResult(null));

    await provider.updateById(7, { pathname: 'cafe%CC%81' }, true);

    expect(articleModel.findOne).toHaveBeenNthCalledWith(
      2,
      {
        id: { $ne: 7 },
        $or: [{ pathname: 'café' }, { pathname: 'café' }],
      },
      { id: 1, _id: 0 },
    );
    expect(articleModel.updateOne).toHaveBeenCalledWith(
      { id: 7 },
      expect.objectContaining({ $set: expect.objectContaining({ pathname: 'café' }) }),
    );
  });
});
