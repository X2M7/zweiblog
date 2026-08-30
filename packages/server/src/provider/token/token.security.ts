import { createHash } from 'node:crypto';

export const API_TOKEN_USER_ID = 666666;
export const API_TOKEN_DEFAULT_TTL_DAYS = 90;
export const API_TOKEN_MAX_TTL_DAYS = 90;
export const API_TOKEN_NAME_MAX_LENGTH = 64;

export function hashToken(token: string) {
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('Token must not be empty');
  }
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function normalizeApiTokenName(value: unknown) {
  if (typeof value !== 'string') throw new Error('Token name is required');
  const name = value.trim();
  if (!name || name.length > API_TOKEN_NAME_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error(`Token name must be between 1 and ${API_TOKEN_NAME_MAX_LENGTH} characters`);
  }
  return name;
}

export function normalizeApiTokenTtlDays(value: unknown) {
  if (value === undefined || value === null) return API_TOKEN_DEFAULT_TTL_DAYS;
  if (
    !Number.isInteger(value) ||
    (value as number) < 1 ||
    (value as number) > API_TOKEN_MAX_TTL_DAYS
  ) {
    throw new Error(`API token lifetime must be between 1 and ${API_TOKEN_MAX_TTL_DAYS} days`);
  }
  return value as number;
}

export function tokenExpiresAt(issuedAt: Date, expiresInSeconds: number) {
  return new Date(issuedAt.getTime() + expiresInSeconds * 1000);
}

export function isTokenRecordExpired(record: {
  expiresAt?: Date | string;
  createdAt?: Date | string;
  expiresIn?: number;
}) {
  if (record?.expiresAt) return new Date(record.expiresAt).getTime() <= Date.now();
  if (record?.createdAt && Number.isFinite(record.expiresIn)) {
    return tokenExpiresAt(new Date(record.createdAt), record.expiresIn).getTime() <= Date.now();
  }
  return false;
}
