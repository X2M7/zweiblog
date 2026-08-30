import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { Model } from 'mongoose';
import { RateLimit, RateLimitDocument } from '../../scheme/rateLimit.schema';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export const rateLimitKeyHash = (scope: string, identity: string) =>
  createHash('sha256').update(`${scope}\0${identity}`, 'utf8').digest('hex');

@Injectable()
export class RateLimitProvider {
  constructor(
    @InjectModel(RateLimit.name)
    private readonly rateLimitModel: Model<RateLimitDocument>,
  ) {}

  async consume(
    scope: string,
    identity: string,
    maxAttempts: number,
    windowSeconds: number,
  ): Promise<RateLimitResult> {
    const limit = Math.max(1, Math.min(10_000, Math.floor(Number(maxAttempts) || 1)));
    const duration = Math.max(1, Math.min(86_400, Math.floor(Number(windowSeconds) || 1)));
    const now = Date.now();
    const windowMs = duration * 1000;
    const bucket = Math.floor(now / windowMs);
    const keyHash = rateLimitKeyHash(String(scope).slice(0, 64), String(identity).slice(0, 2048));
    const expiresAt = new Date((bucket + 1) * windowMs + 60_000);
    const query = { keyHash, bucket };
    const update = {
      $inc: { count: 1 },
      $setOnInsert: { keyHash, bucket, expiresAt },
    };

    let state: RateLimitDocument | null;
    try {
      state = await this.rateLimitModel
        .findOneAndUpdate(query, update, {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true,
        })
        .exec();
    } catch (error: any) {
      // Concurrent first writes can race before the unique index is visible.
      // Retry without upsert; the winning request already created the bucket.
      if (error?.code !== 11000) throw error;
      state = await this.rateLimitModel
        .findOneAndUpdate(query, { $inc: { count: 1 } }, { new: true })
        .exec();
    }

    const count = Math.max(1, Number(state?.count) || 1);
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: Math.max(1, Math.ceil(((bucket + 1) * windowMs - now) / 1000)),
    };
  }

  async clear(scope: string, identity: string) {
    const keyHash = rateLimitKeyHash(String(scope).slice(0, 64), String(identity).slice(0, 2048));
    await this.rateLimitModel.deleteMany({ keyHash }).exec();
  }
}
