import {
  Body,
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Optional,
  PayloadTooLargeException,
  Post,
  Query,
  Req,
  Res,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { createHmac, randomBytes } from 'crypto';
import { CommentProvider } from 'src/provider/comment/comment.provider';
import { CommentMaintenanceProvider } from 'src/provider/comment/commentMaintenance.provider';
import { RateLimitProvider } from 'src/provider/rateLimit/rateLimit.provider';
import { CreateCommentDto } from 'src/types/comment.dto';
import { normalizeCommentId, normalizeCommentPath, normalizeCommentPaths } from 'src/utils/comment';
import { parseBoundedInteger } from 'src/utils/query';
import { CommentImageProvider } from 'src/provider/comment/commentImage.provider';
import { commentImageUploadOptions } from 'src/utils/uploadLimits';
import { normalizeImageToWebp, readSafeImageMetadata } from 'src/utils/imageMetadata';

const REACTION_COOKIE = 'zweiblog_comment_actor';
const REACTION_COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1_000;

@ApiTags('comment')
@Controller('/api/public/comment')
export class PublicCommentController {
  constructor(
    private readonly commentProvider: CommentProvider,
    private readonly rateLimitProvider: RateLimitProvider,
    private readonly commentMaintenanceProvider: CommentMaintenanceProvider,
    @Optional() private readonly commentImageProvider?: CommentImageProvider,
  ) {}

  private async assertRateLimit(scope: string, identity: string, max: number, seconds: number) {
    const result = await this.rateLimitProvider.consume(scope, identity, max, seconds);
    if (!result.allowed) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: '请求过于频繁，请稍后再试',
          retryAfterSeconds: result.retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private assertSameOrigin(request: Request) {
    if (String(request.headers['sec-fetch-site'] || '').toLocaleLowerCase() === 'cross-site') {
      throw new ForbiddenException('Cross-site comment changes are not allowed');
    }
    let host = request.get('host');
    const remoteAddress = request.socket?.remoteAddress;
    const trustProxy = request.app?.get?.('trust proxy fn');
    // Next's local rewrite changes the upstream Host and preserves the browser
    // host in X-Forwarded-Host. Honor it only when Express' configured trust
    // function confirms the immediate peer (Caddy/Next) is trusted.
    if (remoteAddress && typeof trustProxy === 'function' && trustProxy(remoteAddress, 0)) {
      const forwardedHost = String(request.headers['x-forwarded-host'] || '')
        .split(',')[0]
        .trim();
      if (forwardedHost) host = forwardedHost;
    }
    if (!host) throw new ForbiddenException('A valid request host is required');
    let expectedOrigin: string;
    try {
      if (/[\u0000-\u0020\\/?#@]/u.test(host)) throw new Error('invalid host');
      expectedOrigin = new URL(`${request.protocol}://${host}`).origin;
    } catch {
      throw new ForbiddenException('A valid request host is required');
    }
    for (const header of ['origin', 'referer'] as const) {
      const value = request.headers[header];
      if (!value) continue;
      try {
        if (new URL(String(value)).origin !== expectedOrigin) {
          throw new ForbiddenException('Cross-site comment changes are not allowed');
        }
      } catch (error) {
        if (error instanceof ForbiddenException) throw error;
        throw new ForbiddenException('Invalid request origin');
      }
    }
  }

  private assertSameOriginJson(request: Request) {
    const contentType = String(request.headers['content-type'] || '').toLocaleLowerCase();
    if (!/^application\/json(?:\s*;|$)/u.test(contentType)) {
      throw new UnsupportedMediaTypeException('Comment changes require application/json');
    }
    this.assertSameOrigin(request);
  }

  private requestIp(request: Request) {
    return String(request.ip || request.socket?.remoteAddress || 'unknown').slice(0, 128);
  }

  private reactionActor(request: Request, response?: Response, create = false): string | undefined {
    const cookies = String(request.headers.cookie || '')
      .split(';')
      .map((part) => part.trim().split('='))
      .filter(([name]) => name === REACTION_COOKIE);
    let token = '';
    try {
      token = cookies.length ? decodeURIComponent(cookies[0].slice(1).join('=')) : '';
    } catch {
      token = '';
    }
    if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) token = '';
    if (!token && create) {
      token = randomBytes(32).toString('base64url');
      response?.cookie(REACTION_COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: request.secure,
        maxAge: REACTION_COOKIE_MAX_AGE_MS,
        path: '/',
      });
    }
    if (!token) return undefined;
    const secret = String(
      global.jwtSecret || process.env.ZWEI_BLOG_REACTION_SECRET || 'zweiblog-local-reaction-v1',
    );
    return createHmac('sha256', secret).update(token).digest('hex');
  }

  @Get()
  async list(
    @Query('path') path: unknown,
    @Query('page') pageValue: unknown,
    @Query('pageSize') pageSizeValue: unknown,
    @Req() request: Request,
  ) {
    await this.assertRateLimit('comment:read:ip', this.requestIp(request), 120, 60);
    const page = parseBoundedInteger(pageValue, 1, 1, 1_000);
    const pageSize = parseBoundedInteger(pageSizeValue, 10, 1, 10);
    return {
      statusCode: 200,
      data: await this.commentProvider.listPublic(
        path,
        page,
        pageSize,
        this.reactionActor(request),
      ),
    };
  }

  @Get('/count')
  async count(@Query('paths') pathsValue: unknown, @Req() request: Request) {
    await this.assertRateLimit('comment:read:ip', this.requestIp(request), 120, 60);
    const paths = normalizeCommentPaths(pathsValue);
    return {
      statusCode: 200,
      data: await this.commentProvider.countPublic(paths),
    };
  }

  @Post()
  async create(@Body() body: CreateCommentDto, @Req() request: Request) {
    this.assertSameOriginJson(request);
    const path = normalizeCommentPath(body?.path ?? body?.url);
    const ip = this.requestIp(request);
    // Consume a fixed per-IP bucket before the database lookup. Rotating an
    // attacker-controlled path can no longer create unlimited limiter rows.
    await this.assertRateLimit('comment:create:ip', ip, 20, 600);
    const target = await this.commentProvider.assertPublicTarget(path);
    const targetIdentity =
      target.articleId === undefined ? target.path : `article:${target.articleId}`;
    await this.assertRateLimit('comment:create:target', `${ip}\0${targetIdentity}`, 5, 600);
    return {
      statusCode: 200,
      data: await this.commentMaintenanceProvider.withExclusive('public-comment-create', () =>
        this.commentProvider.create(
          body,
          target,
          async () => {
            // Cross-IP target buckets make IPv6/source-address rotation
            // expensive. Reserving them only after provider validation means a
            // malformed body or invalid reply cannot drain everyone else's
            // allowance.
            await this.assertRateLimit('comment:create:target-hour', targetIdentity, 30, 3_600);
            await this.assertRateLimit('comment:create:target-day', targetIdentity, 100, 86_400);
          },
          {
            ip,
            ua: request.get('user-agent') || '',
          },
        ),
      ),
    };
  }

  @Post('/image')
  @UseInterceptors(FileInterceptor('file', commentImageUploadOptions))
  async uploadImage(@UploadedFile() file: Express.Multer.File, @Req() request: Request) {
    this.assertSameOrigin(request);
    const ip = this.requestIp(request);
    await this.assertRateLimit('comment:image:ip-hour', ip, 10, 3_600);
    await this.assertRateLimit('comment:image:ip-day', ip, 30, 86_400);
    if (!this.commentImageProvider || !file || !Buffer.isBuffer(file.buffer)) {
      throw new BadRequestException('请选择一张图片');
    }
    // Re-encoding removes metadata, SVG active content and trailing polyglot
    // payloads. Animated inputs deliberately become one static first frame so
    // anonymous uploads cannot expand into an unbounded animation.
    const { buffer: normalized } = await normalizeImageToWebp(file.buffer, 82);
    if (normalized.byteLength > 5 * 1024 * 1024) {
      throw new PayloadTooLargeException('处理后的图片超过 5 MB');
    }
    readSafeImageMetadata(normalized);
    const saved = await this.commentImageProvider.saveNormalizedWebp(normalized);
    return {
      statusCode: 200,
      data: {
        src: saved.src,
        markdown: `![图片](${saved.src})`,
      },
    };
  }

  @Post('/:id/like')
  async like(
    @Param('id') idValue: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response?: Response,
  ) {
    this.assertSameOriginJson(request);
    const id = normalizeCommentId(idValue, true);
    const ip = this.requestIp(request);
    await this.assertRateLimit('comment:like:ip', ip, 200, 86_400);
    await this.commentProvider.assertLikeable(id);
    await this.assertRateLimit('comment:like:item', `${ip}\0${id}`, 20, 600);
    const actorHash = this.reactionActor(request, response, true) as string;
    return {
      statusCode: 200,
      data: await this.commentMaintenanceProvider.withExclusive('comment-like', () =>
        this.commentProvider.like(id, actorHash),
      ),
    };
  }
}
