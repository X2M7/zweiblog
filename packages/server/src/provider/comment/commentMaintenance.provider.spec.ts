import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { CommentMaintenanceProvider } from './commentMaintenance.provider';

describe('CommentMaintenanceProvider', () => {
  const locks: any = {
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn(),
    deleteOne: jest.fn(),
  };
  const provider = new CommentMaintenanceProvider({
    db: { collection: jest.fn(() => locks) },
  } as any);

  beforeEach(() => {
    jest.clearAllMocks();
    locks.findOneAndUpdate.mockImplementation(async (_filter: any, update: any) => ({
      _id: 'comment-data-maintenance',
      ...update.$set,
      ...update.$setOnInsert,
    }));
    locks.updateOne.mockResolvedValue({ matchedCount: 1 });
    locks.deleteOne.mockResolvedValue({ deletedCount: 1 });
  });

  it('holds and renews one database lease around a mutation', async () => {
    const action = jest.fn(async (lease) => {
      await lease.assertOwned();
      return 'done';
    });

    await expect(provider.withExclusive('test-write', action)).resolves.toBe('done');
    expect(locks.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(locks.updateOne).toHaveBeenCalledTimes(2);
    expect(locks.deleteOne).toHaveBeenCalledTimes(1);
  });

  it('fails closed when another instance owns the lock', async () => {
    locks.findOneAndUpdate.mockRejectedValueOnce({ code: 11000 });
    const action = jest.fn();

    await expect(provider.withExclusive('blocked', action)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(action).not.toHaveBeenCalled();
  });

  it('reports a lost lease and still attempts an owner-scoped release', async () => {
    locks.updateOne.mockResolvedValueOnce({ matchedCount: 0 });

    await expect(provider.withExclusive('lost', async () => 'written')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(locks.deleteOne).toHaveBeenCalledTimes(1);
  });
});
