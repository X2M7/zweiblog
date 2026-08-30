import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { CommentSchema } from 'src/scheme/comment.schema';
import { CommentProvider } from './comment.provider';

const queryResult = <T>(value: T) => {
  const query: any = {
    lean: jest.fn(() => query),
    maxTimeMS: jest.fn(() => query),
    select: jest.fn(() => query),
    exec: jest.fn().mockResolvedValue(value),
  };
  return query;
};

const aggregateResult = <T>(value: T) => {
  const query: any = {
    option: jest.fn(() => query),
    exec: jest.fn().mockResolvedValue(value),
  };
  return query;
};

describe('CommentProvider public access boundary', () => {
  const commentModel: any = {
    create: jest.fn(),
    aggregate: jest.fn(),
  };
  const articleModel: any = {
    find: jest.fn(),
    findOne: jest.fn(),
  };
  const categoryModel: any = {
    find: jest.fn(),
    findOne: jest.fn(),
  };
  const settingProvider: any = {
    getCommentSetting: jest.fn().mockResolvedValue({
      moderation: 'off',
      pageSize: 20,
      maxLength: 5_000,
    }),
  };
  const metaProvider: any = {
    getSiteInfo: jest.fn(),
  };
  const provider = new CommentProvider(
    commentModel,
    articleModel,
    categoryModel,
    {} as any,
    settingProvider,
    metaProvider,
    {} as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    commentModel.create.mockReset();
    metaProvider.getSiteInfo.mockResolvedValue({
      enableComment: 'true',
      allowOpenHiddenPostByUrl: 'false',
    });
    articleModel.find.mockReturnValue(queryResult([]));
    articleModel.findOne.mockReturnValue(queryResult(null));
    categoryModel.find.mockReturnValue(queryResult([]));
    categoryModel.findOne.mockReturnValue(queryResult(null));
  });

  it('enforces the site switch on the server before looking up a target', async () => {
    metaProvider.getSiteInfo.mockResolvedValue({ enableComment: 'false' });
    await expect(provider.assertPublicTarget('/about')).rejects.toBeInstanceOf(NotFoundException);
    await expect(provider.assertPublicTarget('/post/1')).rejects.toBeInstanceOf(NotFoundException);
    expect(articleModel.find).not.toHaveBeenCalled();
  });

  it('also honors a legacy boolean false site switch', async () => {
    metaProvider.getSiteInfo.mockResolvedValue({ enableComment: false });
    await expect(provider.assertPublicTarget('/link')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('only accepts built-in pages and real public articles', async () => {
    await expect(provider.assertPublicTarget('/made-up')).rejects.toBeInstanceOf(NotFoundException);
    await expect(provider.assertPublicTarget('/about')).resolves.toMatchObject({ path: '/about' });

    articleModel.find.mockReturnValue(
      queryResult([
        {
          id: 7,
          pathname: '中文 slug',
          category: 'public',
          private: false,
          hidden: false,
        },
      ]),
    );
    await expect(provider.assertPublicTarget('/post/%E4%B8%AD%E6%96%87%20slug')).resolves.toEqual({
      path: '/post/中文 slug',
      articleId: 7,
      aliases: expect.arrayContaining(['/post/7', '/post/中文 slug']),
    });
  });

  it.each([
    [{ id: 1, pathname: 'secret', category: 'public', private: true, hidden: false }, []],
    [{ id: 1, pathname: 'secret', category: 'secret', private: false, hidden: false }, ['secret']],
    [{ id: 1, pathname: 'secret', category: 'public', private: false, hidden: true }, []],
  ])(
    'does not expose private, private-category or disallowed hidden article comments',
    async (article, privateCategories) => {
      articleModel.find.mockReturnValue(queryResult([article]));
      categoryModel.find.mockReturnValue(
        queryResult(privateCategories.map((name) => ({ name, private: true }))),
      );
      await expect(provider.assertPublicTarget('/post/secret')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    },
  );

  it('turns the duplicate unique-index race into a deterministic conflict', async () => {
    commentModel.create.mockRejectedValueOnce({ code: 11000, message: 'duplicateKeys dup key' });
    await expect(
      provider.create(
        { path: '/about', content: 'same', nick: 'Alice' },
        { path: '/about', aliases: ['/about'] },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not reserve a shared target quota before body validation succeeds', async () => {
    const beforeInsert = jest.fn().mockResolvedValue(undefined);

    await expect(
      provider.create(
        { path: '/about', content: 'x'.repeat(5_001), nick: 'Alice' },
        { path: '/about', aliases: ['/about'] },
        beforeInsert,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(beforeInsert).not.toHaveBeenCalled();
    expect(commentModel.create).not.toHaveBeenCalled();
  });

  it('checks a stored articleId directly even when another article owns its numeric pathname', async () => {
    articleModel.findOne.mockReturnValue(
      queryResult({
        id: 7,
        pathname: 'public-slug',
        category: 'public',
        private: false,
        hidden: false,
      }),
    );
    articleModel.find.mockReturnValue(
      queryResult([{ id: 99, pathname: '7', category: 'secret', private: true, hidden: false }]),
    );
    await expect(
      (provider as any).assertPublicRecord({
        _id: '507f1f77bcf86cd799439011',
        path: '/post/public-slug',
        articleId: 7,
      }),
    ).resolves.toMatchObject({ articleId: 7 });
    expect(articleModel.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7 }),
      expect.any(Object),
    );
  });

  it('counts old path-only records whose articleId is explicitly null', async () => {
    commentModel.aggregate.mockReturnValueOnce(
      aggregateResult([{ _id: { path: '/about', articleId: null }, count: 3 }]),
    );

    await expect(provider.countPublic(['/about'])).resolves.toEqual({ '/about': 3 });
  });

  it('pages deleted-root placeholders without materialising an unbounded distinct result', async () => {
    commentModel.aggregate.mockReturnValueOnce(
      aggregateResult([{ metadata: [{ total: 0 }], items: [] }]),
    );

    await expect(provider.listPublic('/about', 1, 20)).resolves.toMatchObject({
      items: [],
      total: 0,
      page: 1,
    });
    const pipeline = commentModel.aggregate.mock.calls[0][0];
    expect(pipeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ $lookup: expect.any(Object) }),
        expect.objectContaining({ $facet: expect.any(Object) }),
      ]),
    );
  });

  it('declares an atomic unique multikey index for overlapping duplicate buckets', () => {
    expect(CommentSchema.indexes()).toEqual(
      expect.arrayContaining([
        [{ duplicateKeys: 1 }, expect.objectContaining({ unique: true, sparse: true })],
      ]),
    );
  });

  it('declares a partial unique slot index that makes the reply cap atomic', () => {
    expect(CommentSchema.indexes()).toEqual(
      expect.arrayContaining([
        [
          { rootId: 1, threadPosition: 1 },
          expect.objectContaining({
            unique: true,
            partialFilterExpression: {
              rootId: { $type: 'objectId' },
              threadPosition: { $type: 'number' },
            },
          }),
        ],
      ]),
    );
  });

  it('allows only one of two concurrent replies when one thread slot remains', async () => {
    const occupied = new Set(Array.from({ length: 99 }, (_, index) => index + 1));
    commentModel.create.mockImplementation(async (document: any) => {
      const position = Number(document.threadPosition);
      if (occupied.has(position)) {
        throw {
          code: 11000,
          keyPattern: { rootId: 1, threadPosition: 1 },
          message: 'rootId_1_threadPosition_1 dup key',
        };
      }
      occupied.add(position);
      return document;
    });
    const rootId = new Types.ObjectId();

    const results = await Promise.allSettled([
      (provider as any).createCommentDocument({ content: 'first' }, rootId),
      (provider as any).createCommentDocument({ content: 'second' }, rootId),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(
      (result) => result.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(BadRequestException);
    expect(occupied.size).toBe(100);
  });

  it('always excludes quarantined rows from both page and article targets', async () => {
    expect((provider as any).targetFilter({ path: '/about', aliases: ['/about'] })).toEqual({
      path: '/about',
      quarantined: { $ne: true },
    });
    expect(
      (provider as any).targetFilter({
        path: '/post/current-slug',
        articleId: 7,
        aliases: ['/post/current-slug', '/post/7'],
      }),
    ).toEqual({
      $and: [
        { quarantined: { $ne: true } },
        {
          $or: [
            { articleId: 7 },
            {
              $and: [
                { path: '/post/current-slug' },
                { $or: [{ articleId: { $exists: false } }, { articleId: null }] },
              ],
            },
          ],
        },
      ],
    });

    await expect(
      (provider as any).assertPublicRecord({
        _id: new Types.ObjectId(),
        path: '/post/current-slug',
        articleId: 7,
        quarantined: true,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(articleModel.findOne).not.toHaveBeenCalled();
  });
});
