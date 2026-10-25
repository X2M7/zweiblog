import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
} from '@nestjs/common';
import { CommentProvider } from 'src/provider/comment/comment.provider';
import { CommentImageProvider } from 'src/provider/comment/commentImage.provider';
import { RateLimitProvider } from 'src/provider/rateLimit/rateLimit.provider';
import { assertSameOriginCommentRequest } from 'src/utils/commentOrigin';

export const COMMENT_IMAGE_TARGET = Symbol('validated-comment-image-target');
export const COMMENT_IMAGE_LEASE = Symbol('comment-image-processing-lease');

export interface CommentImageProcessingLease {
  beginProcessing(): void;
  release(): void;
}

/** Guards run before Multer, so rejected requests never allocate an image buffer. */
@Injectable()
export class CommentImageUploadGuard implements CanActivate {
  private active = 0;
  constructor(
    private readonly comments: CommentProvider,
    private readonly images: CommentImageProvider,
    private readonly limits: RateLimitProvider,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    assertSameOriginCommentRequest(request);
    const ip = String(request.ip || request.socket?.remoteAddress || 'unknown').slice(0, 128);
    for (const [scope, identity, max, seconds] of [
      ['comment:image:global-hour', 'all', 100, 3600],
      ['comment:image:global-day', 'all', 500, 86400],
      ['comment:image:ip-hour', ip, 10, 3600],
      ['comment:image:ip-day', ip, 30, 86400],
    ] as const) {
      const result = await this.limits.consume(scope, identity, max, seconds);
      if (!result.allowed) throw new HttpException('Comment image upload limit reached', 429);
    }
    const target = await this.comments.assertPublicTarget(request.query?.path);
    await this.images.assertCapacity();
    const disconnected = () => request.aborted || response.destroyed || response.writableEnded;
    if (disconnected()) throw new BadRequestException('Comment image request has ended');
    if (this.active >= 2) throw new HttpException('Comment image processing is busy', 429);
    this.active++;
    let state: 'reserved' | 'processing' | 'released' = 'reserved';
    const release = () => {
      if (state === 'released') return;
      state = 'released';
      this.active--;
      response.off('finish', releaseBeforeProcessing);
      response.off('close', releaseBeforeProcessing);
    };
    const releaseBeforeProcessing = () => {
      // Multer errors/disconnects must release reservations. Once the
      // controller starts Sharp, only its finally block can release the slot:
      // socket closure does not cancel the native image-processing job.
      if (state === 'reserved') release();
    };
    const lease: CommentImageProcessingLease = {
      beginProcessing() {
        if (state !== 'reserved' || disconnected()) {
          releaseBeforeProcessing();
          throw new BadRequestException('Comment image request has ended');
        }
        // No await between checking the connection and claiming the lease.
        state = 'processing';
      },
      release,
    };
    response.once('finish', releaseBeforeProcessing);
    response.once('close', releaseBeforeProcessing);
    request[COMMENT_IMAGE_TARGET] = target;
    request[COMMENT_IMAGE_LEASE] = lease;
    return true;
  }
}
