import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { AdminCommentPurgeController } from './comment.purge.controller';

const query = (value: unknown) => ({
  select: jest.fn().mockReturnThis(),
  lean: jest.fn().mockReturnThis(),
  maxTimeMS: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue(value),
});

const makeTombstoneModel = () => ({
  updateOne: jest.fn().mockReturnValue(query({ upsertedCount: 1 })),
});

const makeMaintenanceProvider = () => ({
  withExclusive: jest.fn((_operation, action) => action({ assertOwned: jest.fn() })),
});

const makeModel = ({ existing, descendants = 0, deletedCount = 1 }: any = {}) => ({
  findById: jest.fn().mockReturnValue(query(existing)),
  countDocuments: jest.fn().mockReturnValue(query(descendants)),
  updateOne: jest.fn().mockReturnValue(query({ modifiedCount: 1 })),
  deleteOne: jest.fn().mockReturnValue(query({ deletedCount })),
});

describe('AdminCommentPurgeController', () => {
  const id = new Types.ObjectId().toHexString();

  it('requires a prior soft deletion', async () => {
    const model = makeModel({ existing: { _id: id, status: 'approved' } });
    const controller = new AdminCommentPurgeController(
      model as any,
      makeTombstoneModel() as any,
      makeMaintenanceProvider() as any,
    );

    await expect(controller.purge(id)).rejects.toBeInstanceOf(BadRequestException);
    expect(model.deleteOne).not.toHaveBeenCalled();
  });

  it('physically removes a deleted leaf comment', async () => {
    const model = makeModel({ existing: { _id: id, status: 'deleted' } });
    const controller = new AdminCommentPurgeController(
      model as any,
      makeTombstoneModel() as any,
      makeMaintenanceProvider() as any,
    );

    const result = await controller.purge(id);

    expect(result.data).toMatchObject({ purged: true, placeholder: false, removed: true });
    expect(model.deleteOne).toHaveBeenCalled();
    expect(model.updateOne).not.toHaveBeenCalled();
  });

  it('records a no-PII migration tombstone before removing a migrated leaf', async () => {
    const model = makeModel({
      existing: { _id: id, status: 'deleted', legacyId: 'waline-comment-id' },
    });
    const tombstoneModel = makeTombstoneModel();
    const controller = new AdminCommentPurgeController(
      model as any,
      tombstoneModel as any,
      makeMaintenanceProvider() as any,
    );

    await controller.purge(id);

    expect(tombstoneModel.updateOne).toHaveBeenCalledWith(
      { legacyId: 'waline-comment-id' },
      { $setOnInsert: { legacyId: 'waline-comment-id' } },
      { upsert: true },
    );
    expect(tombstoneModel.updateOne.mock.invocationCallOrder[0]).toBeLessThan(
      model.deleteOne.mock.invocationCallOrder[0],
    );
  });

  it('fails closed and keeps the scrubbed comment if tombstone storage fails', async () => {
    const model = makeModel({
      existing: { _id: id, status: 'deleted', legacyId: 'waline-comment-id' },
    });
    const tombstoneModel = makeTombstoneModel();
    tombstoneModel.updateOne.mockReturnValueOnce({
      exec: jest.fn().mockRejectedValue(new Error('tombstone unavailable')),
    });
    const controller = new AdminCommentPurgeController(
      model as any,
      tombstoneModel as any,
      makeMaintenanceProvider() as any,
    );

    await expect(controller.purge(id)).rejects.toThrow('tombstone unavailable');
    expect(model.deleteOne).not.toHaveBeenCalled();
  });

  it('scrubs a deleted comment while retaining a reply-tree placeholder', async () => {
    const model = makeModel({
      existing: { _id: id, status: 'deleted' },
      descendants: 3,
    });
    const controller = new AdminCommentPurgeController(
      model as any,
      makeTombstoneModel() as any,
      makeMaintenanceProvider() as any,
    );

    const result = await controller.purge(id);

    expect(result.data).toMatchObject({
      purged: true,
      placeholder: true,
      removed: false,
      descendantsPreserved: 3,
    });
    const update = model.updateOne.mock.calls[0][1];
    expect(update.$set).toMatchObject({
      content: '[deleted]',
      nick: 'Anonymous',
      mail: '',
      link: '',
      likes: 0,
    });
    expect(update.$unset).toEqual({ duplicateKeys: 1 });
    expect(update.$unset).not.toHaveProperty('legacyId');
    expect(model.deleteOne).not.toHaveBeenCalled();
  });

  it('does not hide a missing record behind a successful response', async () => {
    const model = makeModel({ existing: null });
    const controller = new AdminCommentPurgeController(
      model as any,
      makeTombstoneModel() as any,
      makeMaintenanceProvider() as any,
    );

    await expect(controller.purge(id)).rejects.toBeInstanceOf(NotFoundException);
  });
});
