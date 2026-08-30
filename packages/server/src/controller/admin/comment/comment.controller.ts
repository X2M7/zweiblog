import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { config } from 'src/config';
import { AdminGuard } from 'src/provider/auth/auth.guard';
import { CommentProvider } from 'src/provider/comment/comment.provider';
import { CommentMaintenanceProvider } from 'src/provider/comment/commentMaintenance.provider';
import { ApiToken } from 'src/provider/swagger/token';
import { COMMENT_STATUSES, CommentStatus } from 'src/types/comment.dto';
import { normalizeModerationStatus } from 'src/utils/comment';
import { parseBoundedInteger, parseOptionalQueryString } from 'src/utils/query';

@ApiTags('comment-admin')
@ApiToken
@UseGuards(...AdminGuard)
@Controller('/api/admin/comment')
export class AdminCommentController {
  constructor(
    private readonly commentProvider: CommentProvider,
    private readonly commentMaintenanceProvider: CommentMaintenanceProvider,
  ) {}

  private assertWritable() {
    if (config.demo === true || config.demo === 'true') {
      throw new BadRequestException('演示站禁止修改评论');
    }
  }

  @Get()
  async list(
    @Query('page') pageValue: unknown,
    @Query('pageSize') pageSizeValue: unknown,
    @Query('status') statusValue?: unknown,
    @Query('path') pathValue?: unknown,
    @Query('search') searchValue?: unknown,
  ) {
    const page = parseBoundedInteger(pageValue, 1, 1, 1_000_000);
    const pageSize = parseBoundedInteger(pageSizeValue, 20, 1, 100);
    let status: CommentStatus | undefined;
    if (statusValue !== undefined && statusValue !== '') {
      if (typeof statusValue !== 'string' || !COMMENT_STATUSES.includes(statusValue as any)) {
        throw new BadRequestException('Invalid comment status');
      }
      status = statusValue as CommentStatus;
    }
    return {
      statusCode: 200,
      data: await this.commentProvider.listAdmin({
        page,
        pageSize,
        status,
        path: parseOptionalQueryString(pathValue, 512),
        search: parseOptionalQueryString(searchValue, 100),
      }),
    };
  }

  @Patch('/:id')
  async updateStatus(@Param('id') id: string, @Body() body: { status?: unknown }) {
    this.assertWritable();
    const status = normalizeModerationStatus(body?.status);
    return {
      statusCode: 200,
      data: await this.commentMaintenanceProvider.withExclusive('comment-moderation', () =>
        this.commentProvider.updateStatus(id, status),
      ),
    };
  }

  @Delete('/:id')
  async remove(@Param('id') id: string) {
    this.assertWritable();
    return {
      statusCode: 200,
      data: await this.commentMaintenanceProvider.withExclusive('comment-delete', () =>
        this.commentProvider.softDelete(id),
      ),
    };
  }

  @Post('/:id/reply')
  async reply(@Param('id') id: string, @Body() body: { content?: unknown }, @Req() request: any) {
    this.assertWritable();
    return {
      statusCode: 200,
      data: await this.commentMaintenanceProvider.withExclusive('admin-comment-reply', () =>
        this.commentProvider.replyAsAdmin(id, body?.content, request?.user?.nickname, {
          ip: request?.ip || request?.socket?.remoteAddress || 'unknown',
          ua: request?.get?.('user-agent') || request?.headers?.['user-agent'] || '',
        }),
      ),
    };
  }

  @Post('/migration/waline')
  async migrateWaline() {
    this.assertWritable();
    return {
      statusCode: 200,
      data: await this.commentMaintenanceProvider.withExclusive('waline-migration', () =>
        this.commentProvider.migrateWaline(),
      ),
    };
  }
}
