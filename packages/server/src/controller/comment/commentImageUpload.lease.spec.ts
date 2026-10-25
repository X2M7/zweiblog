import { EventEmitter } from 'node:events';
import { BadRequestException, HttpException } from '@nestjs/common';
import { normalizeImageToWebp } from 'src/utils/imageMetadata';
import { PublicCommentController } from './comment.controller';
import { CommentImageUploadGuard } from './commentImageUpload.guard';

jest.mock('src/utils/imageMetadata', () => ({
  normalizeImageToWebp: jest.fn(),
  readSafeImageMetadata: jest.fn(),
}));

function pending<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((success, failure) => {
    resolve = success;
    reject = failure;
  });
  return { promise, resolve, reject };
}

function connection() {
  const response = Object.assign(new EventEmitter(), { destroyed: false, writableEnded: false });
  const request: any = {
    headers: {},
    protocol: 'http',
    query: { path: '/post/1' },
    ip: '127.0.0.1',
    get: (name: string) => (name === 'host' ? 'example.test' : undefined),
  };
  return {
    request,
    response,
    context: {
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
    } as any,
    disconnect() {
      response.destroyed = true;
      response.emit('close');
    },
  };
}

describe('comment image processing leases', () => {
  const normalize = normalizeImageToWebp as jest.Mock;
  const file = { buffer: Buffer.from('image') } as Express.Multer.File;
  let guard: CommentImageUploadGuard;
  let controller: PublicCommentController;
  beforeEach(() => {
    jest.clearAllMocks();
    const comments: any = {
      assertPublicTarget: jest.fn().mockResolvedValue({ path: '/post/1', articleId: 1 }),
    };
    const images: any = {
      assertCapacity: jest.fn().mockResolvedValue(undefined),
      saveNormalizedWebp: jest
        .fn()
        .mockResolvedValue({ src: '/api/public/comment-image/test.webp' }),
    };
    const limits: any = { consume: jest.fn().mockResolvedValue({ allowed: true }) };
    guard = new CommentImageUploadGuard(comments, images, limits);
    controller = new PublicCommentController(comments, limits, {} as any, images);
    normalize.mockResolvedValue({ buffer: Buffer.from('webp') });
  });

  it.each(['resolve', 'reject'] as const)(
    'keeps disconnected Sharp jobs admitted until their finally blocks %s',
    async (outcome) => {
      const job1 = pending<{ buffer: Buffer }>();
      const job2 = pending<{ buffer: Buffer }>();
      normalize.mockReturnValueOnce(job1.promise).mockReturnValueOnce(job2.promise);
      const first = connection();
      const second = connection();
      await guard.canActivate(first.context);
      await guard.canActivate(second.context);
      const operation1 = controller.uploadImage(file, first.request);
      const operation2 = controller.uploadImage(file, second.request);
      const operations = Promise.allSettled([operation1, operation2]);
      first.disconnect();
      second.disconnect();
      first.response.emit('finish');
      await expect(guard.canActivate(connection().context)).rejects.toMatchObject({ status: 429 });
      expect(normalize).toHaveBeenCalledTimes(2);
      if (outcome === 'resolve') job1.resolve({ buffer: Buffer.from('webp') });
      else job1.reject(new BadRequestException('invalid image'));
      await operation1.catch(() => undefined);
      const next = connection();
      await expect(guard.canActivate(next.context)).resolves.toBe(true);
      await controller.uploadImage(file, next.request);
      job2.resolve({ buffer: Buffer.from('webp') });
      await operations;
    },
  );

  it('does not start Sharp when Multer completed after the connection released its reservation', async () => {
    const abandoned = connection();
    await guard.canActivate(abandoned.context);
    abandoned.disconnect();
    const first = connection();
    const second = connection();
    await guard.canActivate(first.context);
    await guard.canActivate(second.context);
    await expect(controller.uploadImage(file, abandoned.request)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(normalize).not.toHaveBeenCalled();
    await expect(guard.canActivate(connection().context)).rejects.toMatchObject({ status: 429 });
    first.disconnect();
    second.disconnect();
  });

  it('also checks an already-closed socket before starting Sharp even without a close notification', async () => {
    const abandoned = connection();
    await guard.canActivate(abandoned.context);
    abandoned.response.destroyed = true;
    await expect(controller.uploadImage(file, abandoned.request)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(normalize).not.toHaveBeenCalled();
    await expect(guard.canActivate(connection().context)).resolves.toBe(true);
  });

  it('releases capacity after controller validation errors', async () => {
    for (let index = 0; index < 3; index++) {
      const current = connection();
      await guard.canActivate(current.context);
      await expect(controller.uploadImage(undefined, current.request)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
    expect(normalize).not.toHaveBeenCalled();
  });

  it('rejects disconnected requests before reserving a slot', async () => {
    const abandoned = connection();
    abandoned.disconnect();
    await expect(guard.canActivate(abandoned.context)).rejects.toBeInstanceOf(HttpException);
    await expect(guard.canActivate(connection().context)).resolves.toBe(true);
    await expect(guard.canActivate(connection().context)).resolves.toBe(true);
  });
});
