import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AdminGuard } from 'src/provider/auth/auth.guard';
import { ImgController } from './img.controller';

describe('authenticated image ZIP downloads', () => {
  it('retains every administrator guard on the controller', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, ImgController)).toEqual(AdminGuard);
  });

  it('cleans the archive if the connection closed during ZIP generation', async () => {
    const cleanup = jest.fn().mockResolvedValue(undefined);
    const controller = new ImgController({
      exportAllImg: jest.fn().mockResolvedValue({ archivePath: '/private/images.zip', cleanup }),
    } as any);
    const response: any = { destroyed: true, download: jest.fn() };
    await controller.exportAllImgs(response);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(response.download).not.toHaveBeenCalled();
  });

  it.each(['complete', 'disconnect', 'throw'])('cleans private files on %s', async (scenario) => {
    const cleanup = jest.fn().mockResolvedValue(undefined);
    const controller = new ImgController({
      exportAllImg: jest.fn().mockResolvedValue({ archivePath: '/private/images.zip', cleanup }),
    } as any);
    const callbacks: Record<string, () => void> = {};
    const response: any = {
      setHeader: jest.fn(),
      type: jest.fn(),
      once: jest.fn((event, callback) => {
        callbacks[event] = callback;
      }),
      download: jest.fn((_path, _name, callback) => {
        if (scenario === 'throw') throw new Error('send failed');
        if (scenario === 'complete') callback();
      }),
    };
    if (scenario === 'throw') {
      await expect(controller.exportAllImgs(response)).rejects.toThrow('send failed');
    } else {
      await controller.exportAllImgs(response);
      if (scenario === 'disconnect') callbacks.close();
    }
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(response.download).toHaveBeenCalledWith(
      '/private/images.zip',
      'zweiblog-images.zip',
      expect.any(Function),
    );
  });
});
