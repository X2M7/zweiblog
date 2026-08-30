import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import { Collection } from 'mongodb';
import { Connection } from 'mongoose';

const COMMENT_MAINTENANCE_LOCK_ID = 'comment-data-maintenance';
const COMMENT_MAINTENANCE_LEASE_MS = 5 * 60_000;
const COMMENT_MAINTENANCE_RENEW_MS = 30_000;

interface CommentMaintenanceLockRecord {
  _id: string;
  owner: string;
  operation: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CommentMaintenanceLease {
  assertOwned(): Promise<void>;
}

/**
 * A short Mongo-backed exclusive lease coordinates comment mutations across
 * every application instance. It is deliberately fail-closed: normal writes
 * receive a conflict while migration/restore is active, and a crashed process
 * releases itself automatically when the lease expires.
 */
@Injectable()
export class CommentMaintenanceProvider {
  private readonly locks: Collection<CommentMaintenanceLockRecord>;

  constructor(@InjectConnection() connection: Connection) {
    if (!connection.db) throw new Error('MongoDB connection is unavailable');
    this.locks = connection.db.collection<CommentMaintenanceLockRecord>('zweiblog_operation_locks');
  }

  private conflict() {
    return new ConflictException(
      'Comment data is busy; retry after the current operation finishes',
    );
  }

  async withExclusive<T>(
    operation: string,
    action: (lease: CommentMaintenanceLease) => Promise<T>,
  ): Promise<T> {
    const owner = randomUUID();
    const now = new Date();
    let acquired: CommentMaintenanceLockRecord | null;
    try {
      acquired = await this.locks.findOneAndUpdate(
        {
          _id: COMMENT_MAINTENANCE_LOCK_ID,
          $or: [{ expiresAt: { $lte: now } }, { expiresAt: { $exists: false } }],
        },
        {
          $set: {
            owner,
            operation: String(operation || 'comment-write').slice(0, 100),
            expiresAt: new Date(now.getTime() + COMMENT_MAINTENANCE_LEASE_MS),
            updatedAt: now,
          },
          $setOnInsert: { createdAt: now },
        },
        { upsert: true, returnDocument: 'after', includeResultMetadata: false },
      );
    } catch (error: any) {
      if (error?.code === 11000) throw this.conflict();
      throw error;
    }
    if (!acquired || acquired.owner !== owner) throw this.conflict();

    let leaseError: unknown;
    let renewal: Promise<void> | null = null;
    const renew = () => {
      if (renewal) return renewal;
      renewal = (async () => {
        const renewed = await this.locks.updateOne(
          { _id: COMMENT_MAINTENANCE_LOCK_ID, owner },
          {
            $set: {
              expiresAt: new Date(Date.now() + COMMENT_MAINTENANCE_LEASE_MS),
              updatedAt: new Date(),
            },
          },
        );
        if (renewed.matchedCount !== 1) {
          throw new ServiceUnavailableException('Comment maintenance lease was lost');
        }
      })().finally(() => {
        renewal = null;
      });
      return renewal;
    };
    const lease: CommentMaintenanceLease = {
      assertOwned: async () => {
        if (leaseError) throw leaseError;
        await renew();
        if (leaseError) throw leaseError;
      },
    };
    const timer = setInterval(() => {
      void renew().catch((error) => {
        leaseError = error;
      });
    }, COMMENT_MAINTENANCE_RENEW_MS);
    timer.unref?.();

    try {
      const result = await action(lease);
      await lease.assertOwned();
      return result;
    } finally {
      clearInterval(timer);
      if (renewal) await renewal.catch(() => undefined);
      await this.locks
        .deleteOne({ _id: COMMENT_MAINTENANCE_LOCK_ID, owner })
        .catch(() => undefined);
    }
  }
}
