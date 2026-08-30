import {
  API_TOKEN_DEFAULT_TTL_DAYS,
  hashToken,
  isTokenRecordExpired,
  normalizeApiTokenName,
  normalizeApiTokenTtlDays,
  tokenExpiresAt,
} from './token.security';

describe('token security helpers', () => {
  it('stores a deterministic SHA-256 digest instead of the raw token', () => {
    const raw = 'header.payload.signature';
    const digest = hashToken(raw);
    expect(digest).toHaveLength(64);
    expect(digest).not.toContain(raw);
    expect(hashToken(raw)).toBe(digest);
  });

  it('normalizes token names and enforces their maximum length', () => {
    expect(normalizeApiTokenName('  publishing bot  ')).toBe('publishing bot');
    expect(() => normalizeApiTokenName('')).toThrow('between 1 and 64');
    expect(() => normalizeApiTokenName('x'.repeat(65))).toThrow('between 1 and 64');
    expect(() => normalizeApiTokenName('line\nbreak')).toThrow('between 1 and 64');
  });

  it('defaults to 90 days and rejects longer API-token lifetimes', () => {
    expect(normalizeApiTokenTtlDays(undefined)).toBe(API_TOKEN_DEFAULT_TTL_DAYS);
    expect(normalizeApiTokenTtlDays(30)).toBe(30);
    expect(() => normalizeApiTokenTtlDays(91)).toThrow('between 1 and 90');
    expect(() => normalizeApiTokenTtlDays(1.5)).toThrow('between 1 and 90');
  });

  it('recognizes explicit and legacy expiry metadata', () => {
    const issuedAt = new Date(Date.now() - 2_000);
    expect(isTokenRecordExpired({ expiresAt: tokenExpiresAt(issuedAt, 1) })).toBe(true);
    expect(isTokenRecordExpired({ createdAt: issuedAt, expiresIn: 1 })).toBe(true);
    expect(isTokenRecordExpired({ createdAt: new Date(), expiresIn: 60 })).toBe(false);
  });
});
