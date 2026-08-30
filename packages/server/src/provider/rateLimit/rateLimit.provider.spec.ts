import { rateLimitKeyHash } from './rateLimit.provider';

describe('rateLimitKeyHash', () => {
  it('is deterministic without persisting the raw identity', () => {
    const identity = '203.0.113.10:admin@example.com';
    const hash = rateLimitKeyHash('login', identity);

    expect(hash).toHaveLength(64);
    expect(hash).toBe(rateLimitKeyHash('login', identity));
    expect(hash).not.toContain(identity);
  });

  it('separates scopes', () => {
    expect(rateLimitKeyHash('login', 'same')).not.toBe(rateLimitKeyHash('comment:create', 'same'));
  });
});
