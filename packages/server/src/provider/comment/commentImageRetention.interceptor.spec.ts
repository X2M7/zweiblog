import { of } from 'rxjs';
import { CommentImageRetentionInterceptor } from './commentImageRetention.interceptor';

describe('administrator attachment retention admission', () => {
  const images: any = { retainAdminReferences: jest.fn() };
  const interceptor = new CommentImageRetentionInterceptor(images);
  const context = (request: any): any => ({ switchToHttp: () => ({ getRequest: () => request }) });
  beforeEach(() => jest.clearAllMocks());

  it('waits for retention before the authenticated content writer can run', async () => {
    let release: () => void;
    images.retainAdminReferences.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const next = { handle: jest.fn(() => of('saved')) };
    const body = { about: { content: 'image' } };
    const pending = interceptor.intercept(
      context({ user: { id: 1 }, path: '/api/admin/about', method: 'PUT', headers: {}, body }),
      next,
    );
    expect(images.retainAdminReferences).toHaveBeenCalledWith(body, false);
    expect(next.handle).not.toHaveBeenCalled();
    release!();
    await pending;
    expect(next.handle).toHaveBeenCalledTimes(1);
  });

  it('does not let anonymous or login requests pin temporary images', async () => {
    for (const request of [
      { path: '/api/public/comment', method: 'POST' },
      { path: '/api/admin/article', method: 'POST' },
      { path: '/api/admin/auth/login', method: 'POST', user: { id: 1 } },
      { path: '/api/admin/article', method: 'GET', user: { id: 1 } },
    ])
      await interceptor.intercept(context({ ...request, headers: {} }), { handle: () => of(null) });
    expect(images.retainAdminReferences).not.toHaveBeenCalled();
  });

  it('fails before persistence if retention cannot be safely completed', async () => {
    images.retainAdminReferences.mockRejectedValueOnce(new Error('database unavailable'));
    const next = { handle: jest.fn(() => of(null)) };
    await expect(
      interceptor.intercept(
        context({
          user: { id: 1 },
          path: '/api/admin/customPage/upload',
          method: 'POST',
          headers: { 'content-type': 'multipart/form-data; boundary=x' },
        }),
        next,
      ),
    ).rejects.toThrow('database unavailable');
    expect(images.retainAdminReferences).toHaveBeenCalledWith(undefined, true);
    expect(next.handle).not.toHaveBeenCalled();
  });
  it('uses the matched admin route despite case differences in the request path', async () => {
    images.retainAdminReferences.mockResolvedValueOnce(undefined);
    const body = { content: 'image' };
    await interceptor.intercept(
      context({
        user: { id: 1 },
        path: '/api/ADMIN/article',
        route: { path: '/api/admin/article' },
        method: 'PUT',
        headers: {},
        body,
      }),
      { handle: () => of(null) },
    );
    expect(images.retainAdminReferences).toHaveBeenCalledWith(body, false);
  });
});
