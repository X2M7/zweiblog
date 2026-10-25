import { Controller, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { CommentImageUploadGuard } from './commentImageUpload.guard';

@Controller('/upload')
class ProbeController {
  @Post()
  @UseGuards(CommentImageUploadGuard)
  @UseInterceptors(FileInterceptor('file'))
  upload(@UploadedFile() file: any) {
    return { bytes: file?.buffer?.length };
  }
}

describe('comment image admission before multipart parsing', () => {
  let app: any;
  const comments: any = { assertPublicTarget: jest.fn() };
  const images: any = { assertCapacity: jest.fn() };
  const limits: any = { consume: jest.fn() };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ProbeController],
      providers: [
        {
          provide: CommentImageUploadGuard,
          useValue: new CommentImageUploadGuard(comments, images, limits),
        },
      ],
    })
      .overrideGuard(CommentImageUploadGuard)
      .useValue(new CommentImageUploadGuard(comments, images, limits))
      .compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => app?.close());
  beforeEach(() => {
    jest.clearAllMocks();
    comments.assertPublicTarget.mockResolvedValue({
      path: '/post/1',
      articleId: 1,
      aliases: ['/post/1'],
    });
    images.assertCapacity.mockResolvedValue(undefined);
    limits.consume.mockResolvedValue({ allowed: true });
  });
  it('rejects disabled/private/nonexistent targets before malformed multipart is parsed', async () => {
    const { NotFoundException } = await import('@nestjs/common');
    comments.assertPublicTarget.mockRejectedValue(new NotFoundException('unavailable'));
    await request(app.getHttpServer())
      .post('/upload?path=%2Fpost%2F1')
      .set('content-type', 'multipart/form-data')
      .send('invalid body')
      .expect(404);
    expect(images.assertCapacity).not.toHaveBeenCalled();
  });
  it('rejects a cross-site browser before any quota or target lookup', async () => {
    await request(app.getHttpServer())
      .post('/upload?path=%2Fpost%2F1')
      .set('sec-fetch-site', 'cross-site')
      .send('invalid body')
      .expect(403);
    expect(limits.consume).not.toHaveBeenCalled();
    expect(comments.assertPublicTarget).not.toHaveBeenCalled();
  });
  it('uses fixed global/IP limits before looking up attacker-controlled targets', async () => {
    limits.consume.mockResolvedValueOnce({ allowed: false });
    await request(app.getHttpServer())
      .post('/upload?path=%2Fanything')
      .send('invalid body')
      .expect(429);
    expect(limits.consume).toHaveBeenCalledTimes(1);
    expect(limits.consume).toHaveBeenCalledWith('comment:image:global-hour', 'all', 100, 3600);
    expect(comments.assertPublicTarget).not.toHaveBeenCalled();
  });
  it('rejects a full store before reading multipart bytes', async () => {
    const { PayloadTooLargeException } = await import('@nestjs/common');
    images.assertCapacity.mockRejectedValueOnce(new PayloadTooLargeException());
    await request(app.getHttpServer())
      .post('/upload?path=%2Fpost%2F1')
      .set('content-type', 'multipart/form-data')
      .send('invalid body')
      .expect(413);
  });
  it('preserves valid uploads and releases admission on responses', async () => {
    for (let i = 0; i < 3; i++) {
      const response = await request(app.getHttpServer())
        .post('/upload?path=%2Fpost%2F1')
        .attach('file', Buffer.from('abc'), 'sample.webp')
        .expect(201);
      expect(response.body.bytes).toBe(3);
    }
    expect(comments.assertPublicTarget).toHaveBeenCalledWith('/post/1');
  });

  it('releases reservations when Multer rejects before the controller runs', async () => {
    for (let index = 0; index < 3; index++) {
      await request(app.getHttpServer())
        .post('/upload?path=%2Fpost%2F1')
        .set('content-type', 'multipart/form-data')
        .send('missing boundary')
        .expect(400);
    }
    await request(app.getHttpServer())
      .post('/upload?path=%2Fpost%2F1')
      .attach('file', Buffer.from('abc'), 'sample.webp')
      .expect(201);
  });
});
