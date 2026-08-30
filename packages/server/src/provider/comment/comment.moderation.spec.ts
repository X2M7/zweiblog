import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { CommentProvider } from './comment.provider';

const queryResult = <T>(value: T) => {
  const query: any = {
    select: jest.fn(() => query),
    lean: jest.fn(() => query),
    maxTimeMS: jest.fn(() => query),
    exec: jest.fn().mockResolvedValue(value),
  };
  return query;
};

describe('CommentProvider moderation races', () => {
  const id = new Types.ObjectId();
  const existing = {
    _id: id,
    path: '/about',
    content: 'visible',
    nick: 'Alice',
    mail: '',
    link: '',
    parentId: null,
    rootId: null,
    status: 'approved',
    likes: 0,
    isAdmin: false,
  };
  const commentModel: any = {
    findById: jest.fn(),
    findOneAndUpdate: jest.fn(),
    find: jest.fn(),
    updateMany: jest.fn(),
    exists: jest.fn(),
  };
  const provider = new CommentProvider(
    commentModel,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    commentModel.findById.mockReturnValue(queryResult(existing));
    commentModel.findOneAndUpdate.mockReturnValue(queryResult({ ...existing, status: 'pending' }));
    commentModel.find.mockReturnValue(queryResult([]));
    commentModel.updateMany.mockReturnValue(queryResult({ modifiedCount: 0 }));
  });

  it('marks the selected node hidden before collecting descendants', async () => {
    await expect(provider.updateStatus(String(id), 'pending')).resolves.toMatchObject({
      status: 'pending',
    });

    expect(commentModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: String(id), status: { $ne: 'deleted' } },
      { $set: { status: 'pending' } },
      { new: true },
    );
    expect(commentModel.findOneAndUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      commentModel.find.mock.invocationCallOrder[0],
    );
  });

  it('cannot restore a comment that was soft-deleted during moderation', async () => {
    commentModel.findOneAndUpdate.mockReturnValueOnce(queryResult(null));

    await expect(provider.updateStatus(String(id), 'approved')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(commentModel.find).not.toHaveBeenCalled();
    expect(commentModel.updateMany).not.toHaveBeenCalled();
  });
});
