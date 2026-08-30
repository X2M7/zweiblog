import { Types } from 'mongoose';
import { CommentProvider } from './comment.provider';

const queryResult = <T>(value: T) => ({ exec: jest.fn().mockResolvedValue(value) });
const tombstoneQueryResult = <T>(value: T) => {
  const query: any = {
    lean: jest.fn(() => query),
    maxTimeMS: jest.fn(() => query),
    exec: jest.fn().mockResolvedValue(value),
  };
  return query;
};

describe('CommentProvider Waline migration', () => {
  const adminUserId = new Types.ObjectId();
  const comments = [
    {
      _id: new Types.ObjectId(),
      url: '/about',
      comment: 'admin by relation',
      nick: 'Owner',
      mail: 'owner@example.com',
      user_id: adminUserId,
      status: 'approved',
    },
    {
      _id: new Types.ObjectId(),
      url: '/about',
      comment: 'email or raw type alone must not grant admin',
      nick: 'Owner',
      mail: 'OWNER@example.com',
      type: 'administrator',
      status: 'approved',
    },
    {
      _id: new Types.ObjectId(),
      url: '/about',
      comment: 'ordinary visitor',
      nick: 'Visitor',
      mail: 'visitor@example.com',
      status: 'approved',
    },
  ];
  let activeComments: any[] = comments;

  const sourceDb: any = {
    listCollections: jest.fn(() => ({
      toArray: jest.fn().mockResolvedValue([{ name: 'Comment' }, { name: 'Users' }]),
    })),
    collection: jest.fn((name: string) => {
      if (name === 'Users') {
        return {
          find: jest.fn(() => ({
            limit: jest.fn(() => ({
              toArray: jest.fn().mockResolvedValue([
                {
                  _id: adminUserId,
                  objectId: String(adminUserId),
                  mail: 'owner@example.com',
                  type: 'administrator',
                },
                {
                  _id: new Types.ObjectId(),
                  mail: 'visitor@example.com',
                  type: 'guest',
                },
              ]),
            })),
          })),
        };
      }
      return { find: jest.fn(() => activeComments) };
    }),
  };
  const connection: any = {
    getClient: jest.fn(() => ({ db: jest.fn(() => sourceDb) })),
  };
  const commentModel: any = {
    updateOne: jest.fn(),
    exists: jest.fn(() => queryResult(null)),
  };
  const tombstoneModel: any = {
    find: jest.fn(() => tombstoneQueryResult([])),
  };
  const provider = new CommentProvider(
    commentModel,
    {} as any,
    {} as any,
    connection,
    {} as any,
    { getSiteInfo: jest.fn().mockResolvedValue({ enableComment: 'true' }) } as any,
    tombstoneModel,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    activeComments = comments;
    commentModel.updateOne.mockImplementation(() => queryResult({ upsertedCount: 1 }));
    commentModel.exists.mockImplementation(() => queryResult(null));
    tombstoneModel.find.mockImplementation(() => tombstoneQueryResult([]));
  });

  it('restores administrator identity only from trusted Users relation or server type', async () => {
    const result = await provider.migrateWaline();
    expect(result).toMatchObject({ scanned: 3, imported: 3, created: 3, errorCount: 0 });
    const inserted = commentModel.updateOne.mock.calls.map((call: any[]) => call[1].$setOnInsert);
    expect(inserted.map((item: any) => item.isAdmin)).toEqual([true, false, false]);
    expect(commentModel.updateOne.mock.calls.map((call: any[]) => call[2])).toEqual([
      { upsert: true, timestamps: false },
      { upsert: true, timestamps: false },
      { upsert: true, timestamps: false },
    ]);
  });

  it('records a failed row and continues importing later comments', async () => {
    commentModel.updateOne
      .mockReturnValueOnce({ exec: jest.fn().mockRejectedValue(new Error('write failed')) })
      .mockImplementation(() => queryResult({ upsertedCount: 1 }));
    const result = await provider.migrateWaline();
    expect(result).toMatchObject({ scanned: 3, imported: 2, errorCount: 1 });
    expect(result.errors[0]).toMatchObject({
      legacyId: String(comments[0]._id),
      reason: 'write failed',
    });
    expect(commentModel.updateOne).toHaveBeenCalledTimes(3);
  });

  it('refuses to merge legacy data into an already-used native comment collection', async () => {
    commentModel.exists.mockImplementationOnce(() => queryResult({ _id: new Types.ObjectId() }));

    await expect(provider.migrateWaline()).rejects.toThrow(
      'Import Waline before accepting native comments',
    );
    expect(commentModel.updateOne).not.toHaveBeenCalled();
  });

  it('never resurrects a legacy comment covered by a permanent-deletion tombstone', async () => {
    tombstoneModel.find.mockImplementationOnce(() =>
      tombstoneQueryResult([{ legacyId: String(comments[0]._id) }]),
    );

    const result = await provider.migrateWaline();

    expect(result).toMatchObject({ scanned: 3, imported: 2, skipped: 1, errorCount: 0 });
    expect(result.skippedDetails).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          legacyId: String(comments[0]._id),
          reason: 'Comment was permanently deleted after migration',
        }),
      ]),
    );
    expect(commentModel.updateOne).toHaveBeenCalledTimes(2);
  });

  it('derives the root through the pid chain when nested replies omit rid', async () => {
    const rootId = new Types.ObjectId();
    const childId = new Types.ObjectId();
    const grandchildId = new Types.ObjectId();
    activeComments = [
      {
        _id: rootId,
        url: '/about',
        comment: 'root',
        nick: 'Root',
        status: 'approved',
      },
      {
        _id: childId,
        url: '/about',
        comment: 'child',
        nick: 'Child',
        status: 'approved',
        pid: rootId,
      },
      {
        _id: grandchildId,
        url: '/about',
        comment: 'grandchild',
        nick: 'Grandchild',
        status: 'approved',
        pid: childId,
      },
    ];

    await expect(provider.migrateWaline()).resolves.toMatchObject({
      scanned: 3,
      imported: 3,
      skipped: 0,
    });
    const inserted = commentModel.updateOne.mock.calls.map((call: any[]) => call[1].$setOnInsert);
    expect(inserted[1]).toMatchObject({ parentId: rootId, rootId });
    expect(inserted[2]).toMatchObject({ parentId: childId, rootId });
  });

  it('skips an orphaned legacy reply instead of importing an unrenderable row', async () => {
    const orphanId = new Types.ObjectId();
    activeComments = [
      {
        _id: orphanId,
        url: '/about',
        comment: 'orphan',
        nick: 'Orphan',
        status: 'approved',
        pid: new Types.ObjectId(),
      },
    ];

    await expect(provider.migrateWaline()).resolves.toMatchObject({
      scanned: 1,
      imported: 0,
      skipped: 1,
      skippedDetails: [
        {
          legacyId: String(orphanId),
          reason: 'Legacy reply parent is missing',
        },
      ],
    });
    expect(commentModel.updateOne).not.toHaveBeenCalled();
  });

  it('does not expose an approved reply below a pending legacy ancestor', async () => {
    const rootId = new Types.ObjectId();
    const childId = new Types.ObjectId();
    activeComments = [
      {
        _id: rootId,
        url: '/about',
        comment: 'awaiting moderation',
        nick: 'Root',
        status: 'waiting',
      },
      {
        _id: childId,
        url: '/about',
        comment: 'must remain hidden',
        nick: 'Child',
        status: 'approved',
        pid: rootId,
      },
    ];

    await expect(provider.migrateWaline()).resolves.toMatchObject({
      scanned: 2,
      imported: 1,
      skipped: 1,
      skippedDetails: [
        {
          legacyId: String(childId),
          reason: 'Legacy approved reply has a hidden ancestor',
        },
      ],
    });
  });

  it('skips new legacy descendants of a permanently deleted migrated comment', async () => {
    const rootId = new Types.ObjectId();
    const childId = new Types.ObjectId();
    activeComments = [
      {
        _id: rootId,
        url: '/about',
        comment: 'deleted before rerun',
        nick: 'Root',
        status: 'approved',
      },
      {
        _id: childId,
        url: '/about',
        comment: 'added in old Waline later',
        nick: 'Child',
        status: 'approved',
        pid: rootId,
      },
    ];
    tombstoneModel.find.mockImplementation(() =>
      tombstoneQueryResult([{ legacyId: String(rootId) }]),
    );

    await expect(provider.migrateWaline()).resolves.toMatchObject({
      scanned: 2,
      imported: 0,
      skipped: 2,
      skippedDetails: expect.arrayContaining([
        {
          legacyId: String(rootId),
          reason: 'Comment was permanently deleted after migration',
        },
        {
          legacyId: String(childId),
          reason: 'Legacy reply has a permanently deleted ancestor',
        },
      ]),
    });
  });

  it('imports at most 100 deterministic replies from an oversized legacy thread', async () => {
    const rootId = new Types.ObjectId();
    const nestedParentId = new Types.ObjectId('ffffffffffffffffffffffff');
    const nestedChildId = new Types.ObjectId('000000000000000000000001');
    activeComments = [
      {
        _id: rootId,
        url: '/about',
        comment: 'root',
        nick: 'Root',
        status: 'approved',
      },
      ...Array.from({ length: 99 }, (_, index) => ({
        _id: new Types.ObjectId(),
        url: '/about',
        comment: `reply ${index}`,
        nick: `Visitor ${index}`,
        status: 'approved',
        pid: rootId,
      })),
      {
        _id: nestedParentId,
        url: '/about',
        comment: 'parent whose id sorts last',
        nick: 'Parent',
        status: 'approved',
        pid: rootId,
      },
      {
        _id: nestedChildId,
        url: '/about',
        comment: 'child whose id sorts first',
        nick: 'Child',
        status: 'approved',
        pid: nestedParentId,
      },
    ];

    await expect(provider.migrateWaline()).resolves.toMatchObject({
      scanned: 102,
      imported: 101,
      skipped: 1,
      errorCount: 0,
      skippedDetails: [
        expect.objectContaining({ reason: 'Legacy thread exceeds the 100-reply limit' }),
      ],
    });
    expect(commentModel.updateOne).toHaveBeenCalledTimes(101);
    const importedIds = commentModel.updateOne.mock.calls.map((call: any[]) =>
      String(call[1].$setOnInsert._id),
    );
    expect(importedIds).toContain(String(nestedParentId));
    expect(importedIds).not.toContain(String(nestedChildId));
  });
});
