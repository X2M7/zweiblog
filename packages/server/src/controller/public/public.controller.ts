import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { SortOrder } from 'src/types/sort';
import { ArticleProvider } from 'src/provider/article/article.provider';
import { CategoryProvider } from 'src/provider/category/category.provider';
import { MetaProvider } from 'src/provider/meta/meta.provider';
import { SettingProvider } from 'src/provider/setting/setting.provider';
import { TagProvider } from 'src/provider/tag/tag.provider';
import { VisitProvider } from 'src/provider/visit/visit.provider';
import { version } from 'src/utils/loadConfig';
import { CustomPageProvider } from 'src/provider/customPage/customPage.provider';
import { encode } from 'js-base64';
import { parseBoundedInteger, parseOptionalQueryString, parseQueryBoolean } from 'src/utils/query';
import { RateLimitProvider } from 'src/provider/rateLimit/rateLimit.provider';

const PUBLIC_PAGE_SIZE_MAX = 100;
const PUBLIC_BULK_EXPORT_LIMIT = 5_000;

@ApiTags('public')
@Controller('/api/public/')
export class PublicController {
  constructor(
    private readonly articleProvider: ArticleProvider,
    private readonly categoryProvider: CategoryProvider,
    private readonly tagProvider: TagProvider,
    private readonly metaProvider: MetaProvider,
    private readonly visitProvider: VisitProvider,
    private readonly settingProvider: SettingProvider,
    private readonly customPageProvider: CustomPageProvider,
    private readonly rateLimitProvider: RateLimitProvider,
  ) {}

  private requestOrigin(req: Request): string {
    let host = req.get('host');
    const remoteAddress = req.socket?.remoteAddress;
    const trustProxy = req.app?.get?.('trust proxy fn');
    // Next's development rewrite changes the upstream Host while preserving
    // the browser-facing host here. Accept it only from a proxy Express trusts,
    // otherwise an attacker could forge the comparison target.
    if (remoteAddress && typeof trustProxy === 'function' && trustProxy(remoteAddress, 0)) {
      const forwardedHost = String(req.headers['x-forwarded-host'] || '')
        .split(',')[0]
        .trim();
      if (forwardedHost) host = forwardedHost;
    }
    if (!host || /[\u0000-\u0020\\/?#@]/u.test(host)) {
      throw new BadRequestException('Invalid request host');
    }
    try {
      return new URL(`${req.protocol}://${host}`).origin;
    } catch {
      throw new BadRequestException('Invalid request host');
    }
  }

  @Get('/customPage/all')
  async getAll() {
    return {
      statusCode: 200,
      data: await this.customPageProvider.getAll(),
    };
  }
  @Get('/customPage')
  async getOneByPath(@Query('path') path: string) {
    const data = await this.customPageProvider.getCustomPageByPath(path);

    return {
      statusCode: 200,
      data: {
        ...data,
        html: data?.html ? encode(data?.html) : '',
      },
    };
  }
  @Get('/article/:id')
  async getArticleByIdOrPathname(@Param('id') id: string) {
    const data = await this.articleProvider.getByIdOrPathnameWithPreNext(id, 'public');
    return {
      statusCode: 200,
      data: data,
    };
  }
  @Post('/article/:id')
  async getArticleByIdOrPathnameWithPassword(
    @Param('id') id: number | string,
    @Body() body: { password: string },
    @Req() req: Request,
  ) {
    const rawId = String(id).normalize('NFKC').slice(0, 512);
    const numericId = Number(rawId);
    const canonicalId =
      rawId.trim() && Number.isSafeInteger(numericId) && numericId >= 0 ? String(numericId) : rawId;
    const ip = String(req.ip || req.socket?.remoteAddress || 'unknown')
      .trim()
      .slice(0, 128);
    const identity = `${ip}\0${canonicalId}`;
    const limit = await this.rateLimitProvider.consume('content-password', identity, 10, 15 * 60);
    if (!limit.allowed) {
      throw new HttpException(
        {
          statusCode: 429,
          message: `Too many password attempts. Retry in ${limit.retryAfterSeconds} seconds.`,
          retryAfter: limit.retryAfterSeconds,
        },
        429,
      );
    }

    const data = await this.articleProvider.getByIdWithPassword(id, body?.password);
    if (data) {
      await this.rateLimitProvider.clear('content-password', identity);
    }
    return {
      statusCode: 200,
      data: data,
    };
  }

  @Get('/search')
  async searchArticle(@Query('value') search: string) {
    const data = await this.articleProvider.searchByString(search, false);

    return {
      statusCode: 200,
      data: {
        total: data.length,
        data: this.articleProvider.toSearchResult(data),
      },
    };
  }
  @Post('/viewer')
  async addViewer(
    @Query('isNew') isNew: boolean,
    @Query('isNewByPath') isNewByPath: boolean,
    @Req() req: Request,
  ) {
    const refer = req.headers.referer;
    if (!refer) {
      throw new BadRequestException('A same-origin referrer is required');
    }
    let url: URL;
    try {
      url = new URL(refer);
    } catch {
      throw new BadRequestException('Invalid referrer');
    }
    const expectedOrigin = this.requestOrigin(req);
    if (url.origin !== expectedOrigin) {
      throw new ForbiddenException('Cross-origin viewer updates are not allowed');
    }
    if (!url.pathname || url.pathname.length > 1024) {
      throw new BadRequestException('Invalid viewer path');
    }
    const data = await this.metaProvider.addViewer(
      String(isNew) === 'true',
      decodeURIComponent(url.pathname),
      String(isNewByPath) === 'true',
    );
    return {
      statusCode: 200,
      data: data,
    };
  }

  @Get('/viewer')
  async getViewer() {
    const data = await this.metaProvider.getViewer();
    return {
      statusCode: 200,
      data: data,
    };
  }
  @Get('/article/viewer/:id')
  async getViewerByArticleIdOrPathname(@Param('id') id: number | string) {
    const data = await this.visitProvider.getByArticleId(id);
    return {
      statusCode: 200,
      data: data,
    };
  }

  @Get('/tag/:name')
  async getArticlesByTagName(@Param('name') name: string) {
    const data = await this.tagProvider.getArticlesByTag(name, false);
    return {
      statusCode: 200,
      data: this.articleProvider.toPublic(data),
    };
  }
  @Get('article')
  async getByOption(
    @Query('page') page: number,
    @Query('pageSize') pageSize = 5,
    @Query('toListView') toListView = false,
    @Query('regMatch') regMatch = false,
    @Query('withWordCount') withWordCount = false,
    @Query('category') category?: string,
    @Query('tags') tags?: string,
    @Query('sortCreatedAt') sortCreatedAt?: SortOrder,
    @Query('sortTop') sortTop?: SortOrder,
  ) {
    const requestedPageSize = parseBoundedInteger(pageSize, 5, -1, PUBLIC_PAGE_SIZE_MAX);
    if (requestedPageSize === 0) {
      throw new BadRequestException('pageSize must be -1 or a positive integer');
    }
    const option = {
      page: parseBoundedInteger(page, 1, 1, 1_000_000),
      // Legacy static builds request -1. Keep a generous but finite bound so
      // an unauthenticated request cannot force an unbounded collection read.
      pageSize: requestedPageSize === -1 ? PUBLIC_BULK_EXPORT_LIMIT : requestedPageSize,
      category: parseOptionalQueryString(category, 100),
      tags: parseOptionalQueryString(tags, 500),
      toListView: parseQueryBoolean(toListView),
      regMatch: parseQueryBoolean(regMatch),
      sortTop,
      sortCreatedAt,
      withWordCount: parseQueryBoolean(withWordCount),
    };
    // 三个 sort 是完全排他的。
    const data = await this.articleProvider.getByOption(option, true);
    return {
      statusCode: 200,
      data,
    };
  }
  @Get('timeline')
  async getTimeLineInfo() {
    const data = await this.articleProvider.getTimeLineInfo();
    return {
      statusCode: 200,
      data,
    };
  }
  @Get('category')
  async getArticlesByCategory() {
    const data = await this.categoryProvider.getCategoriesWithArticle(false);
    return {
      statusCode: 200,
      data,
    };
  }
  @Get('tag')
  async getArticlesByTag() {
    const data = await this.tagProvider.getTagsWithArticle(false);
    return {
      statusCode: 200,
      data,
    };
  }

  @Get('/meta')
  async getBuildMeta() {
    const tags = await this.tagProvider.getAllTags(false);
    const tagDetails = await this.tagProvider.getTagDetails(false);
    const meta = await this.metaProvider.getAll();
    const metaDoc = (meta as any)?._doc || meta;
    const siteInfo = await this.metaProvider.getSiteInfo();
    const about = await this.metaProvider.getAbout();
    const links = await this.metaProvider.getLinks();
    const linkPage = await this.metaProvider.getLinkPage();
    const categories = await this.categoryProvider.getAllCategories(false);
    const categoryDetails = await this.categoryProvider.getCategoryDetails();
    const { data: menus } = await this.settingProvider.getMenuSetting();
    const totalArticles = await this.articleProvider.getTotalNum(false);
    const totalWordCount = await this.metaProvider.getTotalWords();
    const LayoutSetting = await this.settingProvider.getLayoutSetting();
    const LayoutRes = this.settingProvider.encodeLayoutSetting(LayoutSetting);
    const data = {
      version: version,
      tags,
      tagDetails,
      meta: {
        ...metaDoc,
        siteInfo,
        about,
        links,
        linkPage,
        categories,
        categoryDetails,
      },
      menus,
      totalArticles,
      totalWordCount,
      ...(LayoutSetting ? { layout: LayoutRes } : {}),
    };
    return {
      statusCode: 200,
      data,
    };
  }
}
