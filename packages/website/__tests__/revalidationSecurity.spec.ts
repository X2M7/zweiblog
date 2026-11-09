import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from '../pages/api/revalidate';

const secret = 'test-revalidation-secret-with-32-bytes';
function response() {
  const res: any = {
    revalidate: vi.fn().mockResolvedValue(undefined), json: vi.fn(), send: vi.fn(),
    setHeader: vi.fn(),
  };
  res.status = vi.fn(() => res);
  return res;
}

afterEach(() => vi.unstubAllEnvs());

describe('revalidation authorization', () => {
  it.each([undefined, '', 'incorrect', [secret, secret]])('rejects an invalid secret: %j', async (value) => {
    vi.stubEnv('ZWEI_BLOG_REVALIDATE_SECRET', secret);
    const res = response();
    await handler({ method: 'POST', query: { path: '/about' }, headers: { 'x-zweiblog-revalidate-secret': value } }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.revalidate).not.toHaveBeenCalled();
  });

  it('fails closed when no server secret is configured', async () => {
    vi.stubEnv('ZWEI_BLOG_REVALIDATE_SECRET', '');
    const res = response();
    await handler({ method: 'POST', query: { path: '/about' }, headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.revalidate).not.toHaveBeenCalled();
  });

  it('rejects GET even with a valid secret', async () => {
    vi.stubEnv('ZWEI_BLOG_REVALIDATE_SECRET', secret);
    const res = response();
    await handler({ method: 'GET', query: { path: '/about' }, headers: { 'x-zweiblog-revalidate-secret': secret } }, res);
    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.revalidate).not.toHaveBeenCalled();
  });

  it.each(['/api/admin', '//external.example', '/about?x=1', '/about/../api', ['/about'], 'x'.repeat(2049)])(
    'rejects unsupported paths: %j', async (path) => {
      vi.stubEnv('ZWEI_BLOG_REVALIDATE_SECRET', secret);
      const res = response();
      await handler({ method: 'POST', query: { path }, headers: { 'x-zweiblog-revalidate-secret': secret } }, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.revalidate).not.toHaveBeenCalled();
    },
  );

  it.each(['/about', '/en/about', '/link', '/en/link', '/tag', '/en/tag'])(
    'permits authenticated refreshes of %s', async (path) => {
      vi.stubEnv('ZWEI_BLOG_REVALIDATE_SECRET', secret);
      const res = response();
      await handler({ method: 'POST', query: { path }, headers: { 'x-zweiblog-revalidate-secret': secret } }, res);
      expect(res.revalidate).toHaveBeenCalledWith(path);
      expect(res.json).toHaveBeenCalledWith({ revalidated: true });
    },
  );
});
