import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { ArticleProvider } from 'src/provider/article/article.provider';
import { AdminGuard } from 'src/provider/auth/auth.guard';
import { CategoryProvider } from 'src/provider/category/category.provider';
import { DraftProvider } from 'src/provider/draft/draft.provider';
import { MetaProvider } from 'src/provider/meta/meta.provider';
import { TagProvider } from 'src/provider/tag/tag.provider';
import { UserProvider } from 'src/provider/user/user.provider';
import { FileInterceptor } from '@nestjs/platform-express';
import { removeID } from 'src/utils/removeId';
import { ViewerProvider } from 'src/provider/viewer/viewer.provider';
import { VisitProvider } from 'src/provider/visit/visit.provider';
import { StaticProvider } from 'src/provider/static/static.provider';
import { SettingProvider } from 'src/provider/setting/setting.provider';
import { config } from 'src/config';
import { ApiToken } from 'src/provider/swagger/token';
import { assertBackupFileSize, backupUploadOptions } from 'src/utils/uploadLimits';
import { CommentProvider } from 'src/provider/comment/comment.provider';
import { CommentMaintenanceProvider } from 'src/provider/comment/commentMaintenance.provider';

@ApiTags('backup')
@UseGuards(...AdminGuard)
@ApiToken
@Controller('/api/admin/backup')
export class BackupController {
  private readonly logger = new Logger(BackupController.name);
  constructor(
    private readonly articleProvider: ArticleProvider,
    private readonly categoryProvider: CategoryProvider,
    private readonly tagProvider: TagProvider,
    private readonly metaProvider: MetaProvider,
    private readonly draftProvider: DraftProvider,
    private readonly userProvider: UserProvider,
    private readonly viewerProvider: ViewerProvider,
    private readonly visitProvider: VisitProvider,
    private readonly settingProvider: SettingProvider,
    private readonly staticProvider: StaticProvider,
    private readonly commentProvider: CommentProvider,
    private readonly commentMaintenanceProvider: CommentMaintenanceProvider,
  ) {}

  @Get('export')
  async getAll(@Res() res: Response) {
    return this.commentMaintenanceProvider.withExclusive('backup-export', () =>
      this.getAllUnlocked(res),
    );
  }

  private async getAllUnlocked(res: Response) {
    const articles = await this.articleProvider.exportForBackup();
    const categories = await this.categoryProvider.exportForBackup();
    const tags = await this.tagProvider.getAllTags(true);
    const meta = await this.metaProvider.getAll();
    const drafts = await this.draftProvider.getAll();
    const user = await this.userProvider.exportForBackup();
    // 访客记录
    const viewer = await this.viewerProvider.getAll();
    const visit = await this.visitProvider.getAll();
    // 设置表
    const staticSetting = await this.settingProvider.getStaticSetting();
    const staticItems = await this.staticProvider.exportAll();
    const comments = await this.commentProvider.exportForBackup();
    const commentMigrationTombstones =
      await this.commentProvider.exportMigrationTombstonesForBackup();
    const commentSetting = await this.settingProvider.getCommentSetting();
    const data = {
      articles,
      tags,
      meta,
      drafts,
      categories,
      user,
      viewer,
      visit,
      static: staticItems,
      comments,
      commentMigrationTombstones,
      setting: { static: staticSetting, comment: commentSetting },
    };
    // 拼接一个临时文件
    const name = `zweiblog-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const payload = JSON.stringify(data, null, 2);
    const payloadBytes = Buffer.byteLength(payload, 'utf8');
    assertBackupFileSize(payloadBytes);
    res.attachment(name).type('application/json').send(payload);
  }

  @Post('/import')
  @UseInterceptors(FileInterceptor('file', backupUploadOptions))
  async importAll(@UploadedFile() file: Express.Multer.File) {
    return this.commentMaintenanceProvider.withExclusive('backup-import', () =>
      this.importAllUnlocked(file),
    );
  }

  private async importAllUnlocked(file: Express.Multer.File) {
    if (config.demo && config.demo == 'true') {
      return {
        statusCode: 401,
        message: '演示站禁止修改此项！',
      };
    }
    if (!file || !Buffer.isBuffer(file.buffer)) {
      throw new BadRequestException('A backup file is required');
    }
    let data: any;
    try {
      data = JSON.parse(file.buffer.toString('utf-8'));
    } catch {
      throw new BadRequestException('Invalid backup JSON');
    }
    if (!data || typeof data !== 'object' || !Array.isArray(data.articles)) {
      throw new BadRequestException('Invalid ZweiBlog backup');
    }
    const { meta, user, setting, comments, categories, commentMigrationTombstones } = data;
    let { articles, drafts, viewer, visit, static: staticItems } = data;
    // Validate comment structure and existing unique identities before any
    // provider mutates data. Comments are then written first, so a comment
    // failure cannot happen after a broader site restore has already run.
    await this.commentProvider.validateMigrationTombstonesBackup(commentMigrationTombstones);
    await this.commentProvider.validateBackup(comments);
    const reconciledComments = this.commentProvider.reconcileBackupWithMigrationTombstones(
      comments,
      commentMigrationTombstones,
    );
    const reconciledArticleTargets = this.commentProvider.reconcileBackupArticleTargets(
      reconciledComments.comments,
      articles,
    );
    const commentsForImport = reconciledArticleTargets.comments;
    await this.commentProvider.preflightBackup(commentsForImport);
    // 去掉 id
    articles = removeID(articles);
    drafts = removeID(drafts);
    viewer = removeID(viewer);
    visit = removeID(visit);
    if (staticItems) {
      staticItems = removeID(staticItems);
    }
    if (setting && setting.static) {
      setting.static = { ...setting.static, _id: undefined, __v: undefined };
    }
    delete meta._id;

    await this.commentProvider.importMigrationTombstonesFromBackup(commentMigrationTombstones);
    await this.categoryProvider.importFromBackup(categories);
    await this.articleProvider.importArticles(articles);
    const commentImport = (await this.commentProvider.importFromBackup(commentsForImport)) || {
      imported: 0,
      skipped: 0,
    };
    await this.draftProvider.importDrafts(drafts);
    await this.userProvider.importFromBackup(user);
    await this.metaProvider.update(meta);
    await this.settingProvider.importSetting(setting);
    await this.staticProvider.importItems(staticItems);
    if (visit) {
      await this.visitProvider.import(visit);
    }
    if (viewer) {
      await this.viewerProvider.import(viewer);
    }
    return {
      statusCode: 200,
      data: {
        message: '备份导入完成',
        processed: {
          categories: Array.isArray(categories) ? categories.length : 0,
          articles: Array.isArray(articles) ? articles.length : 0,
          drafts: Array.isArray(drafts) ? drafts.length : 0,
          staticItems: Array.isArray(staticItems) ? staticItems.length : 0,
          comments: Array.isArray(comments) ? comments.length : 0,
          visits: Array.isArray(visit) ? visit.length : 0,
          viewers: Array.isArray(viewer) ? viewer.length : 0,
          administrator: user ? 1 : 0,
          metadata: meta ? 1 : 0,
          settings: setting ? 1 : 0,
        },
        comments: {
          supplied: Array.isArray(comments) ? comments.length : 0,
          written: Number(commentImport.imported) || 0,
          skipped:
            (Number(commentImport.skipped) || 0) + (Number(reconciledComments.suppressed) || 0),
          quarantined: Number(reconciledArticleTargets.quarantined) || 0,
        },
      },
    };
  }
}
