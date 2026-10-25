import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { CommentImageProvider } from './commentImage.provider';

/** Runs after authentication/authorization guards and before content writes. */
@Injectable()
export class CommentImageRetentionInterceptor implements NestInterceptor {
  constructor(private readonly images: CommentImageProvider) {}

  async intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest();
    if (
      request.user &&
      /^\/api\/admin\/(?!auth(?:\/|$))/i.test(request.route?.path || request.path || '') &&
      ['POST', 'PUT', 'PATCH'].includes(request.method)
    ) {
      await this.images.retainAdminReferences(
        request.body,
        /^multipart\/form-data(?:\s*;|$)/i.test(request.headers['content-type'] || ''),
      );
    }
    return next.handle();
  }
}
