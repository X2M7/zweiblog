import { ForbiddenException } from '@nestjs/common';
import { PublicController } from './public.controller';

const makeController = () => {
  const metaProvider: any = {
    addViewer: jest.fn().mockResolvedValue({ viewer: 2, visited: 1 }),
  };
  const unused: any = {};
  const controller = new PublicController(
    unused,
    unused,
    unused,
    metaProvider,
    unused,
    unused,
    unused,
    unused,
  );
  return { controller, metaProvider };
};

const request = (overrides: Record<string, unknown> = {}): any => ({
  protocol: 'http',
  headers: { referer: 'http://127.0.0.1:3001/about' },
  socket: { remoteAddress: '127.0.0.1' },
  app: { get: jest.fn(() => (address: string) => address === '127.0.0.1') },
  get: jest.fn((name: string) => (name === 'host' ? '127.0.0.1:3000' : undefined)),
  ...overrides,
});

describe('public viewer same-origin validation', () => {
  it('accepts the browser-facing host from a trusted local Next proxy', async () => {
    const { controller, metaProvider } = makeController();
    const req = request({
      headers: {
        referer: 'http://127.0.0.1:3001/about',
        'x-forwarded-host': '127.0.0.1:3001',
      },
    });

    await expect(controller.addViewer(true, true, req)).resolves.toEqual({
      statusCode: 200,
      data: { viewer: 2, visited: 1 },
    });
    expect(metaProvider.addViewer).toHaveBeenCalledWith(true, '/about', true);
  });

  it('ignores a forged forwarded host from an untrusted peer', async () => {
    const { controller, metaProvider } = makeController();
    const req = request({
      headers: {
        referer: 'http://127.0.0.1:3001/about',
        'x-forwarded-host': '127.0.0.1:3001',
      },
      socket: { remoteAddress: '203.0.113.8' },
      app: { get: jest.fn(() => () => false) },
    });

    await expect(controller.addViewer(true, true, req)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(metaProvider.addViewer).not.toHaveBeenCalled();
  });
});
