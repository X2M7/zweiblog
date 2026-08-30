import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { CommentProvider } from './comment.provider';

describe('CommentProvider backup compatibility', () => {
  const queryResult = <T>(value: T) => {
    const query: any = {
      select: jest.fn(() => query),
      lean: jest.fn(() => query),
      maxTimeMS: jest.fn(() => query),
      sort: jest.fn(() => query),
      exec: jest.fn().mockResolvedValue(value),
    };
    return query;
  };
  const commentModel: any = {
    bulkWrite: jest.fn().mockResolvedValue({}),
    find: jest.fn(() => queryResult([])),
    countDocuments: jest.fn(() => queryResult(0)),
  };
  const tombstoneModel: any = {
    find: jest.fn(() => queryResult([])),
    bulkWrite: jest.fn().mockResolvedValue({}),
  };
  const provider = new CommentProvider(
    commentModel,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    tombstoneModel,
  );
  const base = {
    id: '507f1f77bcf86cd799439011',
    path: '/post/%E4%B8%AD%E6%96%87',
    content: 'x'.repeat(50_000),
    nick: 'Alice',
    mail: 'alice@example.com',
    status: 'approved',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    legacyId: 'waline-old-id',
    articleId: 42,
  };
  const childId = '507f1f77bcf86cd799439012';
  const grandchildId = '507f1f77bcf86cd799439013';
  const secondRootId = '507f1f77bcf86cd799439014';

  const validationResponse = (value: unknown) => {
    try {
      provider.validateBackup(value);
      throw new Error('Expected backup validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      return (error as BadRequestException).getResponse() as {
        invalid: number;
        errors: Array<{ index: number; id?: string; reason: string }>;
      };
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    commentModel.find.mockImplementation(() => queryResult([]));
    commentModel.countDocuments.mockImplementation(() => queryResult(0));
    tombstoneModel.find.mockImplementation(() => queryResult([]));
    tombstoneModel.bulkWrite.mockResolvedValue({});
  });

  it('round-trips permanent migration tombstones without private comment data', async () => {
    tombstoneModel.find.mockImplementationOnce(() =>
      queryResult([{ legacyId: 'deleted-waline-id' }]),
    );
    await expect(provider.exportMigrationTombstonesForBackup()).resolves.toEqual([
      'deleted-waline-id',
    ]);
    expect(provider.validateMigrationTombstonesBackup(['deleted-waline-id'])).toEqual({ valid: 1 });
    await expect(
      provider.importMigrationTombstonesFromBackup(['deleted-waline-id']),
    ).resolves.toEqual({ imported: 1 });
    expect(tombstoneModel.bulkWrite).toHaveBeenCalledWith(
      [
        {
          updateOne: {
            filter: { legacyId: 'deleted-waline-id' },
            update: { $setOnInsert: { legacyId: 'deleted-waline-id' } },
            upsert: true,
          },
        },
      ],
      { ordered: true },
    );
  });

  it('restores the same 50k legacy content accepted by migration and preserves legacyId', async () => {
    await expect(provider.importFromBackup([base])).resolves.toEqual({
      imported: 1,
      skipped: 0,
      errors: [],
    });
    const operation = commentModel.bulkWrite.mock.calls[0][0][0].updateOne;
    expect(operation.update.$set).toMatchObject({
      path: '/post/中文',
      content: base.content,
      legacyId: 'waline-old-id',
      articleId: 42,
    });
    expect(operation).toMatchObject({
      upsert: true,
      timestamps: false,
    });
    expect(operation.update.$set.createdAt).toEqual(new Date(base.createdAt));
    expect(operation.update.$set.updatedAt).toEqual(new Date(base.updatedAt));
  });

  it('clears stale optional bindings and quarantines an old post backup without articleId', async () => {
    await provider.importFromBackup([
      {
        ...base,
        articleId: undefined,
        legacyId: undefined,
      },
    ]);
    const operation = commentModel.bulkWrite.mock.calls[0][0][0].updateOne;
    expect(operation.update.$set).toMatchObject({ quarantined: true });
    expect(operation.update.$unset).toMatchObject({
      articleId: 1,
      legacyId: 1,
      duplicateKeys: 1,
      threadPosition: 1,
    });
  });

  it('rejects an existing legacyId owned by another comment before bulk writes', async () => {
    commentModel.find.mockImplementationOnce(() =>
      queryResult([{ _id: new Types.ObjectId(childId), legacyId: base.legacyId }]),
    );
    await expect(provider.importFromBackup([base])).rejects.toBeInstanceOf(BadRequestException);
    expect(commentModel.bulkWrite).not.toHaveBeenCalled();
  });

  it('rejects restoring content whose legacy id already has a deletion tombstone', async () => {
    tombstoneModel.find.mockImplementationOnce(() => queryResult([{ legacyId: base.legacyId }]));
    await expect(provider.importFromBackup([base])).rejects.toBeInstanceOf(BadRequestException);
    expect(commentModel.bulkWrite).not.toHaveBeenCalled();
  });

  it('rejects merging a backup into unrelated existing comment identities', async () => {
    commentModel.countDocuments
      .mockReturnValueOnce(queryResult(1))
      .mockReturnValueOnce(queryResult(0));

    await expect(provider.importFromBackup([base])).rejects.toBeInstanceOf(BadRequestException);
    expect(commentModel.bulkWrite).not.toHaveBeenCalled();
  });

  it('lets a tombstone suppress only a scrubbed deleted leaf from a racy export', () => {
    const deletedLeaf = { ...base, status: 'deleted', content: '[deleted]' };
    expect(provider.reconcileBackupWithMigrationTombstones([deletedLeaf], [base.legacyId])).toEqual(
      { comments: [], suppressed: 1 },
    );
    expect(() => provider.reconcileBackupWithMigrationTombstones([base], [base.legacyId])).toThrow(
      BadRequestException,
    );
  });

  it('quarantines stable comment ids whose deleted article is absent from the backup', () => {
    expect(provider.reconcileBackupArticleTargets([base], [{ id: 42 }])).toEqual({
      comments: [base],
      quarantined: 0,
    });
    expect(provider.reconcileBackupArticleTargets([base], [{ id: 7 }])).toEqual({
      comments: [{ ...base, quarantined: true }],
      quarantined: 1,
    });
  });

  it('rejects the whole comment restore with indexed details instead of silently skipping rows', async () => {
    const invalid = { ...base, id: 'not-an-object-id' };
    expect(() => provider.validateBackup([base, invalid])).toThrow(BadRequestException);
    await expect(provider.importFromBackup([base, invalid])).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(commentModel.bulkWrite).not.toHaveBeenCalled();
  });

  it('scrubs private fields from deleted backup placeholders', async () => {
    await provider.importFromBackup([
      { ...base, status: 'deleted', content: 'old secret', mail: 'secret@example.com' },
    ]);
    const restored = commentModel.bulkWrite.mock.calls[0][0][0].updateOne.update.$set;
    expect(restored).toMatchObject({
      status: 'deleted',
      content: '[deleted]',
      nick: 'Anonymous',
      mail: '',
      link: '',
      likes: 0,
      isAdmin: false,
    });
  });

  it('rejects a reply whose direct parent is absent from the backup', () => {
    const response = validationResponse([
      {
        ...base,
        id: childId,
        replyToId: secondRootId,
        parentId: secondRootId,
      },
    ]);
    expect(response).toMatchObject({
      invalid: 1,
      errors: [expect.objectContaining({ id: childId, reason: 'Reply parent is missing' })],
    });
  });

  it('rejects a reply that points to a parent belonging to another target', () => {
    const response = validationResponse([
      base,
      {
        ...base,
        id: childId,
        legacyId: 'cross-target-child',
        path: '/post/another',
        articleId: 43,
        replyToId: base.id,
        parentId: base.id,
      },
    ]);
    expect(response.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: childId, reason: 'Reply crosses comment targets' }),
      ]),
    );
  });

  it('rejects cyclic reply chains', () => {
    const response = validationResponse([
      {
        ...base,
        id: childId,
        legacyId: 'cycle-child',
        replyToId: grandchildId,
        parentId: base.id,
      },
      {
        ...base,
        id: grandchildId,
        legacyId: 'cycle-grandchild',
        replyToId: childId,
        parentId: base.id,
      },
    ]);
    expect(response.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: childId, reason: 'Reply chain contains a cycle' }),
        expect.objectContaining({ id: grandchildId, reason: 'Reply chain contains a cycle' }),
      ]),
    );
  });

  it('rejects a reply whose declared root does not match its ancestor chain', () => {
    const response = validationResponse([
      base,
      { ...base, id: secondRootId, legacyId: 'second-root' },
      {
        ...base,
        id: childId,
        legacyId: 'child',
        replyToId: base.id,
        parentId: secondRootId,
      },
    ]);
    expect(response.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: childId, reason: 'Reply rootId is inconsistent' }),
      ]),
    );
  });

  it('rejects a backup thread with more than 100 replies instead of truncating it', () => {
    const records = [
      base,
      ...Array.from({ length: 101 }, (_, index) => ({
        ...base,
        id: new Types.ObjectId().toHexString(),
        legacyId: `backup-reply-${index}`,
        content: `reply ${index}`,
        replyToId: base.id,
        parentId: base.id,
      })),
    ];

    const response = validationResponse(records);
    expect(response.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'A thread may contain at most 100 replies' }),
      ]),
    );
  });

  it('accepts and restores a valid nested reply graph', async () => {
    const records = [
      base,
      {
        ...base,
        id: childId,
        legacyId: 'child',
        content: 'child',
        replyToId: base.id,
        parentId: base.id,
      },
      {
        ...base,
        id: grandchildId,
        legacyId: 'grandchild',
        content: 'grandchild',
        replyToId: childId,
        parentId: base.id,
      },
    ];

    expect(provider.validateBackup(records)).toEqual({ valid: 3 });
    await expect(provider.importFromBackup(records)).resolves.toEqual({
      imported: 3,
      skipped: 0,
      errors: [],
    });
    const operations = commentModel.bulkWrite.mock.calls[0][0];
    expect(operations[1].updateOne.update.$set).toMatchObject({
      parentId: new Types.ObjectId(base.id),
      rootId: new Types.ObjectId(base.id),
    });
    expect(operations[2].updateOne.update.$set).toMatchObject({
      parentId: new Types.ObjectId(childId),
      rootId: new Types.ObjectId(base.id),
    });
  });
});
