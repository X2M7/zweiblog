import { ServiceUnavailableException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { CommentProvider } from './comment.provider';

const queryResult = <T>(value: T | (() => T)) => {
  const query: any = {
    select: jest.fn(() => query),
    lean: jest.fn(() => query),
    exec: jest.fn(async () => (typeof value === 'function' ? (value as () => T)() : value)),
  };
  return query;
};

describe('CommentProvider reaction toggles', () => {
  const id = new Types.ObjectId();
  const actorHash = 'a'.repeat(64);
  let likes: number;
  let reaction: { _id: Types.ObjectId; commentId: Types.ObjectId; actorHash: string } | null;
  const commentModel: any = {
    findOneAndUpdate: jest.fn(),
  };
  const reactionModel: any = {
    findOne: jest.fn(),
    create: jest.fn(),
    deleteOne: jest.fn(),
  };
  const provider = new CommentProvider(
    commentModel,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    reactionModel,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    likes = 0;
    reaction = null;
    jest.spyOn(provider, 'assertLikeable').mockResolvedValue(String(id));
    reactionModel.findOne.mockImplementation(() => queryResult(() => reaction));
    reactionModel.create.mockImplementation(async ({ commentId, actorHash: hash }) => {
      reaction = {
        _id: new Types.ObjectId(),
        commentId: new Types.ObjectId(commentId),
        actorHash: hash,
      };
      return reaction;
    });
    reactionModel.deleteOne.mockImplementation(() => ({
      exec: jest.fn(async () => {
        reaction = null;
        return { deletedCount: 1 };
      }),
    }));
    commentModel.findOneAndUpdate.mockImplementation((_filter: unknown, update: any) => {
      likes += Number(update?.$inc?.likes || 0);
      return queryResult(() => ({ _id: id, likes }));
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('adds a like and removes the same browser reaction on the next click', async () => {
    await expect(provider.like(String(id), actorHash)).resolves.toEqual({
      id: String(id),
      likes: 1,
      liked: true,
    });
    expect(reactionModel.create).toHaveBeenCalledWith({
      commentId: String(id),
      actorHash,
    });
    expect(commentModel.findOneAndUpdate).toHaveBeenLastCalledWith(
      { _id: String(id), status: 'approved' },
      { $inc: { likes: 1 } },
      { new: true },
    );

    await expect(provider.like(String(id), actorHash)).resolves.toEqual({
      id: String(id),
      likes: 0,
      liked: false,
    });
    expect(reactionModel.deleteOne).toHaveBeenCalledWith({ _id: expect.any(Types.ObjectId) });
    expect(commentModel.findOneAndUpdate).toHaveBeenLastCalledWith(
      { _id: String(id), status: 'approved', likes: { $gt: 0 } },
      { $inc: { likes: -1 } },
      { new: true },
    );
  });

  it('fails closed when the optional reaction store is unavailable', async () => {
    const providerWithoutReactions = new CommentProvider(
      commentModel,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    jest.spyOn(providerWithoutReactions, 'assertLikeable').mockResolvedValue(String(id));

    await expect(providerWithoutReactions.like(String(id), actorHash)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('restores the reaction state if the approved comment disappears during an update', async () => {
    reaction = { _id: new Types.ObjectId(), commentId: id, actorHash };
    commentModel.findOneAndUpdate.mockReturnValueOnce(queryResult(null));

    await expect(provider.like(String(id), actorHash)).rejects.toBeInstanceOf(NotFoundException);
    expect(reactionModel.create).toHaveBeenCalledWith({ commentId: String(id), actorHash });
  });
});
