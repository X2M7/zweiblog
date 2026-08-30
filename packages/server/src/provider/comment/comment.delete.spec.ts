import { Types } from 'mongoose';
import { CommentProvider } from './comment.provider';

const queryResult = <T>(value: T) => {
  const query: any = {
    select: jest.fn(() => query),
    lean: jest.fn(() => query),
    exec: jest.fn().mockResolvedValue(value),
  };
  return query;
};

describe('CommentProvider deletion privacy', () => {
  const id = new Types.ObjectId();
  const base = {
    _id: id,
    path: '/about',
    content: 'private content',
    nick: 'Alice',
    mail: 'alice@example.com',
    link: 'https://example.com/',
    parentId: null,
    rootId: null,
    status: 'approved',
    likes: 3,
    isAdmin: false,
    createdAt: new Date(),
  };
  const commentModel: any = {
    findById: jest.fn(),
    exists: jest.fn(),
    deleteOne: jest.fn(),
    findByIdAndUpdate: jest.fn(),
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
    commentModel.exists.mockReturnValue(queryResult(null));
    commentModel.deleteOne.mockReturnValue(queryResult({ deletedCount: 1 }));
  });

  it('atomically scrubs a native leaf and retains a race-safe placeholder', async () => {
    const scrubbed = {
      ...base,
      status: 'deleted',
      content: '[deleted]',
      nick: 'Anonymous',
      mail: '',
      link: '',
      likes: 0,
    };
    commentModel.findById.mockReturnValue(queryResult(base));
    commentModel.findByIdAndUpdate.mockReturnValue(queryResult(scrubbed));

    await expect(provider.softDelete(String(id))).resolves.toMatchObject({ status: 'deleted' });

    expect(commentModel.deleteOne).not.toHaveBeenCalled();
    expect(commentModel.findByIdAndUpdate).toHaveBeenCalledWith(
      String(id),
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'deleted', mail: '', content: '[deleted]' }),
      }),
      { new: true },
    );
  });

  it('scrubs a migrated leaf but retains legacyId as an anti-resurrection tombstone', async () => {
    const migrated = { ...base, legacyId: 'waline-comment-id' };
    const scrubbed = {
      ...migrated,
      status: 'deleted',
      content: '[deleted]',
      nick: 'Anonymous',
      mail: '',
      link: '',
      likes: 0,
    };
    commentModel.findById.mockReturnValue(queryResult(migrated));
    commentModel.findByIdAndUpdate.mockReturnValue(queryResult(scrubbed));

    await expect(provider.softDelete(String(id))).resolves.toMatchObject({ status: 'deleted' });

    expect(commentModel.deleteOne).not.toHaveBeenCalled();
    const update = commentModel.findByIdAndUpdate.mock.calls[0][1];
    expect(update.$set).toMatchObject({
      status: 'deleted',
      content: '[deleted]',
      nick: 'Anonymous',
      mail: '',
      link: '',
      likes: 0,
    });
    expect(update.$unset).not.toHaveProperty('legacyId');
  });

  it('rolls back a reply inserted while its direct parent is being deleted', async () => {
    const replyId = new Types.ObjectId();
    commentModel.exists.mockReturnValue(queryResult(null));

    await expect(
      (provider as any).retainReplyOnlyWhileParentApproved({ _id: replyId }, id),
    ).rejects.toThrow('The parent comment became unavailable');

    expect(commentModel.deleteOne).toHaveBeenCalledWith({ _id: replyId });
  });
});
