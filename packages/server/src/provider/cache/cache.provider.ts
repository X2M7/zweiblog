import { Injectable } from '@nestjs/common';

interface CacheEntry {
  value: any;
  expiresAt?: number;
}

@Injectable()
export class CacheProvider {
  private readonly data: Record<string, CacheEntry> = Object.create(null);

  get<T = any>(key: string): T {
    const entry = this.data[key];
    if (!entry) {
      return {} as T;
    }
    if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      delete this.data[key];
      return {} as T;
    }
    return entry.value as T;
  }

  set(key: string, value: any, ttlMs?: number) {
    this.data[key] = {
      value,
      expiresAt: typeof ttlMs === 'number' ? Date.now() + Math.max(0, ttlMs) : undefined,
    };
  }

  delete(key: string) {
    delete this.data[key];
  }
}
