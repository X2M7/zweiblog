import {
  BadRequestException,
  Inject,
  Injectable,
  forwardRef,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreateArticleDto, SearchArticleOption, UpdateArticleDto } from 'src/types/article.dto';
import { Article, ArticleDocument } from 'src/scheme/article.schema';
import { parseImgLinksOfMarkdown } from 'src/utils/parseImgOfMarkdown';
import { wordCount } from 'src/utils/wordCount';
import { MetaProvider } from '../meta/meta.provider';
import { VisitProvider } from '../visit/visit.provider';
import { sleep } from 'src/utils/sleep';
import { CategoryDocument } from 'src/scheme/category.schema';
import { escapeRegexLiteral } from 'src/utils/safeRegex';
import {
  hashContentPassword,
  hasContentPassword,
  isValidContentPasswordLength,
  MAX_CONTENT_PASSWORD_LENGTH,
  verifyContentPassword,
} from 'src/utils/contentPassword';
import { isScryptPasswordHash } from 'src/utils/crypto';
import { assertLocalizedArticleFields } from 'src/utils/localizedArticleFields';

export type ArticleView = 'admin' | 'public' | 'list';

const ARTICLE_PATHNAME_MAX_LENGTH = 256;
const ARTICLE_PATHNAME_ENCODED_MAX_LENGTH = ARTICLE_PATHNAME_MAX_LENGTH * 12;
const ARTICLE_PATHNAME_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;
const ARTICLE_PATHNAME_RESERVED_CHARACTERS = /[\/\\?#%]/u;

@Injectable()
export class ArticleProvider {
  idLock = false;
  private identityWriteQueue: Promise<void> = Promise.resolve();
  constructor(
    @InjectModel('Article')
    private articleModel: Model<ArticleDocument>,
    @InjectModel('Category') private categoryModal: Model<CategoryDocument>,
    @Inject(forwardRef(() => MetaProvider))
    private readonly metaProvider: MetaProvider,
    private readonly visitProvider: VisitProvider,
  ) {}

  private async withIdentityWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.identityWriteQueue;
    let release: () => void = () => undefined;
    this.identityWriteQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private assertNoBodyIdentityFields(data: Record<string, unknown>) {
    const immutableField = ['id', '_id', '__v'].find((field) =>
      Object.prototype.hasOwnProperty.call(data, field),
    );
    if (immutableField) {
      throw new BadRequestException(`Article ${immutableField} cannot be supplied in the body`);
    }
  }

  private normalizeArticlePathname(value: unknown): string {
    if (typeof value !== 'string') {
      throw new BadRequestException('Article pathname must be a string');
    }
    if (
      value.length > ARTICLE_PATHNAME_ENCODED_MAX_LENGTH ||
      ARTICLE_PATHNAME_CONTROL_CHARACTERS.test(value)
    ) {
      throw new BadRequestException('Invalid article pathname');
    }

    let pathname: string;
    try {
      pathname = decodeURIComponent(value).normalize('NFC').trim();
    } catch {
      throw new BadRequestException('Invalid article pathname encoding');
    }
    if (!pathname) return '';
    if (
      pathname.length > ARTICLE_PATHNAME_MAX_LENGTH ||
      ARTICLE_PATHNAME_CONTROL_CHARACTERS.test(pathname) ||
      ARTICLE_PATHNAME_RESERVED_CHARACTERS.test(pathname) ||
      pathname === '.' ||
      pathname === '..'
    ) {
      throw new BadRequestException('Invalid article pathname');
    }
    return pathname;
  }

  private async assertPathnameNamespaceAvailable(
    articleId: number,
    pathname: string,
    claimStableId: boolean,
  ) {
    const pathnameClaims = new Set<string>();
    if (pathname) pathnameClaims.add(pathname);
    if (claimStableId) pathnameClaims.add(String(articleId));

    const namespace: any[] = [];
    for (const claim of pathnameClaims) {
      namespace.push({ pathname: claim });
      const decomposedClaim = claim.normalize('NFD');
      if (decomposedClaim !== claim) namespace.push({ pathname: decomposedClaim });
    }
    const numericPathname = Number(pathname);
    if (pathname && Number.isFinite(numericPathname)) {
      // Article routes resolve pathname before falling back to the numeric id.
      // Prevent a custom pathname from shadowing another article's stable id.
      namespace.push({ id: numericPathname });
    }
    if (namespace.length === 0) return;

    const conflictingArticle = await this.articleModel
      .findOne(
        {
          id: { $ne: articleId },
          $or: namespace,
        },
        { id: 1, _id: 0 },
      )
      .exec();
    if (conflictingArticle) {
      throw new BadRequestException('Article pathname conflicts with another article');
    }
  }
  publicView = {
    title: 1,
    titleEn: 1,
    content: 1,
    contentEn: 1,
    summary: 1,
    summaryEn: 1,
    tags: 1,
    category: 1,
    updatedAt: 1,
    createdAt: 1,
    lastVisitedTime: 1,
    id: 1,
    top: 1,
    _id: 0,
    viewer: 1,
    visited: 1,
    private: 1,
    hidden: 1,
    author: 1,
    copyright: 1,
    copyrightEn: 1,
    pathname: 1,
  };

  adminView = {
    title: 1,
    titleEn: 1,
    content: 1,
    contentEn: 1,
    summary: 1,
    summaryEn: 1,
    tags: 1,
    category: 1,
    lastVisitedTime: 1,
    updatedAt: 1,
    createdAt: 1,
    id: 1,
    top: 1,
    hidden: 1,
    private: 1,
    _id: 0,
    viewer: 1,
    visited: 1,
    author: 1,
    copyright: 1,
    copyrightEn: 1,
    pathname: 1,
  };

  listView = {
    title: 1,
    titleEn: 1,
    tags: 1,
    category: 1,
    updatedAt: 1,
    lastVisitedTime: 1,
    createdAt: 1,
    id: 1,
    top: 1,
    hidden: 1,
    private: 1,
    _id: 0,
    viewer: 1,
    visited: 1,
    author: 1,
    copyright: 1,
    copyrightEn: 1,
    pathname: 1,
  };

  /**
   * `contentEn` is selected only long enough to derive the completeness flag
   * used by bilingual list UIs. Every list serializer removes the body before
   * the value can leave this provider.
   */
  private readonly listLookupView = {
    ...this.listView,
    contentEn: 1,
  };

  /**
   * Neighbor lookups need the English body only to determine whether the
   * translation is complete. The serializer below removes it before the
   * record leaves this provider.
   */
  private readonly neighborLookupView = {
    ...this.listView,
    contentEn: 1,
  };

  private articleRecord(article: any): Record<string, any> {
    return typeof article?.toObject === 'function'
      ? article.toObject()
      : { ...(article?._doc || article) };
  }

  private hasCompleteEnglishVersion(article: any): boolean {
    if (typeof article?.hasEnglishVersion === 'boolean') {
      return article.hasEnglishVersion;
    }
    return Boolean(
      typeof article?.titleEn === 'string' &&
        article.titleEn.trim() &&
        typeof article?.contentEn === 'string' &&
        article.contentEn.trim(),
    );
  }

  private publicListArticle(article: any): Record<string, any> {
    const result = this.articleRecord(article);
    const hasEnglishVersion = this.hasCompleteEnglishVersion(result);
    delete result.content;
    delete result.contentEn;
    delete result.summary;
    delete result.summaryEn;
    delete result.password;
    return { ...result, hasEnglishVersion };
  }

  private protectedPublicArticle(article: any): Record<string, any> {
    const result = this.articleRecord(article);
    const hasEnglishVersion = this.hasCompleteEnglishVersion(result);
    delete result.content;
    delete result.contentEn;
    delete result.summary;
    delete result.summaryEn;
    delete result.password;
    result.private = true;
    return { ...result, hasEnglishVersion };
  }

  private publicNeighbor(article: any): Record<string, any> {
    const result = this.articleRecord(article);
    const hasEnglishVersion = this.hasCompleteEnglishVersion(result);
    delete result.content;
    delete result.contentEn;
    delete result.summary;
    delete result.summaryEn;
    delete result.password;
    return { ...result, hasEnglishVersion };
  }

  toPublic(oldArticles: Article[]) {
    return oldArticles.map((item) => {
      const article = this.publicListArticle(item);
      return {
        title: article.title,
        titleEn: article.titleEn,
        tags: article.tags,
        category: article.category,
        updatedAt: article.updatedAt,
        createdAt: article.createdAt,
        id: article.id,
        top: article.top,
        pathname: article.pathname,
        private: article.private,
        hasEnglishVersion: article.hasEnglishVersion,
      };
    });
  }
  async create(
    createArticleDto: CreateArticleDto,
    skipUpdateWordCount?: boolean,
    id?: number,
    trustedImportPasswordHash = false,
  ): Promise<Article> {
    const data = { ...(createArticleDto as any) } as CreateArticleDto & Record<string, unknown>;
    this.assertNoBodyIdentityFields(data);
    assertLocalizedArticleFields(data);
    if (id !== undefined && (!Number.isSafeInteger(id) || id <= 0)) {
      throw new BadRequestException('Article id must be a positive safe integer');
    }
    if (data.private !== undefined && typeof data.private !== 'boolean') {
      throw new BadRequestException('Article private must be a boolean');
    }
    if (data.password !== undefined && typeof data.password !== 'string') {
      throw new BadRequestException('Article password must be a string');
    }
    if (data.pathname !== undefined) {
      data.pathname = this.normalizeArticlePathname(data.pathname);
    }
    if (data.private) {
      if (!isValidContentPasswordLength(data.password)) {
        throw new BadRequestException(
          `Private articles require a password of 1-${MAX_CONTENT_PASSWORD_LENGTH} characters`,
        );
      }
      data.password =
        trustedImportPasswordHash && isScryptPasswordHash(data.password)
          ? data.password
          : await hashContentPassword(data.password);
    } else {
      delete data.password;
    }
    return this.withIdentityWriteLock(async () => {
      const newId = id ?? (await this.getNewId());
      await this.assertPathnameNamespaceAvailable(newId, data.pathname || '', true);

      const createdData = new this.articleModel(data);
      createdData.id = newId;
      if (!skipUpdateWordCount) {
        this.metaProvider.updateTotalWords('新建文章');
      }
      const res: any = await createdData.save();
      const response = { ...(res?.toObject?.() || res?._doc || res) };
      delete response.password;
      delete response._id;
      delete response.__v;
      return response as Article;
    });
  }
  async searchArticlesByLink(link: string) {
    const artciles = await this.articleModel.find(
      {
        $and: [
          {
            $or: [
              { content: { $regex: link, $options: 'i' } },
              { contentEn: { $regex: link, $options: 'i' } },
              { summary: { $regex: link, $options: 'i' } },
              { summaryEn: { $regex: link, $options: 'i' } },
            ],
          },
          {
            $or: [{ deleted: false }, { deleted: { $exists: false } }],
          },
        ],
      },
      this.listView,
    );
    return artciles;
  }
  async getAllImageLinks() {
    const res = [];
    const articles = await this.articleModel.find({
      $or: [
        {
          deleted: false,
        },
        {
          deleted: { $exists: false },
        },
      ],
    });
    for (const article of articles) {
      const eachLinks = Array.from(
        new Set(
          [article.content, article.contentEn, article.summary, article.summaryEn].flatMap(
            (value) => parseImgLinksOfMarkdown(value || ''),
          ),
        ),
      );
      res.push({
        articleId: article.id,
        title: article.title,
        links: eachLinks,
      });
    }
    return res;
  }

  async updateViewerByPathname(pathname: string, isNew: boolean) {
    let article = await this.getByPathName(pathname, 'list');
    if (!article) {
      // 这是通过 id 的吧。
      article = await this.getById(Number(pathname), 'list');
      if (!article) {
        return;
      }
    }
    const oldViewer = article.viewer || 0;
    const oldVIsited = article.visited || 0;
    const newViewer = oldViewer + 1;
    const newVisited = isNew ? oldVIsited + 1 : oldVIsited;
    const nowTime = new Date();
    await this.articleModel.updateOne(
      { id: article.id },
      { visited: newVisited, viewer: newViewer, lastVisitedTime: nowTime },
    );
  }

  async updateViewer(id: number, isNew: boolean) {
    const article = await this.getById(id, 'list');
    if (!article) {
      return;
    }
    const oldViewer = article.viewer || 0;
    const oldVIsited = article.visited || 0;
    const newViewer = oldViewer + 1;
    const newVisited = isNew ? oldVIsited + 1 : oldVIsited;
    const nowTime = new Date();
    await this.articleModel.updateOne(
      { id: id },
      { visited: newVisited, viewer: newViewer, lastVisitedTime: nowTime },
    );
  }

  async getRecentVisitedArticles(num: number, view: ArticleView) {
    return await this.articleModel
      .find(
        {
          lastVisitedTime: { $exists: true },
          $or: [
            {
              deleted: false,
            },
            {
              deleted: { $exists: false },
            },
          ],
        },
        this.getView(view),
      )
      .sort({ lastVisitedTime: -1 })
      .limit(num);
  }

  async getTopViewer(view: ArticleView, num: number) {
    return await this.articleModel
      .find(
        {
          viewer: { $ne: 0, $exists: true },
          $or: [
            {
              deleted: false,
            },
            {
              deleted: { $exists: false },
            },
          ],
        },
        this.getView(view),
      )
      .sort({ viewer: -1 })
      .limit(num);
  }
  async getTopVisited(view: ArticleView, num: number) {
    return await this.articleModel
      .find(
        {
          viewer: { $ne: 0, $exists: true },
          $or: [
            {
              deleted: false,
            },
            {
              deleted: { $exists: false },
            },
          ],
        },
        this.getView(view),
      )
      .sort({ visited: -1 })
      .limit(num);
  }

  async washViewerInfoByVisitProvider() {
    // 用 visitProvider 里面的数据洗一下 article 的。
    const articles = await this.getAll('list', true);
    for (const a of articles) {
      const visitData = await this.visitProvider.getByArticleId(a.id);
      if (visitData) {
        const updateDto = {
          viewer: visitData.viewer,
          visited: visitData.visited,
        };
        await this.updateById(a.id, updateDto);
      }
    }
  }

  async washViewerInfoToVisitProvider() {
    // 用 visitProvider 里面的数据洗一下 article 的。
    const articles = await this.getAll('list', true);
    for (const a of articles) {
      await this.visitProvider.rewriteToday(`/post/${a.id}`, a.viewer, a.visited);
    }
  }

  async importArticles(articles: Article[]) {
    // 先获取一遍新的 id
    // for (let i = 0; i < articles.length; i++) {
    //   const newId = await this.getNewId();
    //   articles[i].id = newId;
    // }

    // id 相同就合并，以导入的优先
    for (const a of articles) {
      const { id, ...createDto } = a;
      const oldArticle = await this.getById(id, 'admin');
      if (oldArticle) {
        await this.updateById(
          oldArticle.id,
          {
            ...createDto,
            deleted: false,
            updatedAt: oldArticle.updatedAt || oldArticle.createdAt,
          },
          true,
          true,
        );
      } else {
        await this.create(
          {
            ...createDto,
            updatedAt: createDto.updatedAt || createDto.createdAt || new Date(),
          },
          true,
          id,
          true,
        );
      }
    }
    this.metaProvider.updateTotalWords('导入文章');
  }

  async countTotalWords() {
    //! 默认不保存 hidden 文章的！
    let total = 0;
    const $and: any = [
      {
        $or: [
          {
            deleted: false,
          },
          {
            deleted: { $exists: false },
          },
        ],
      },
      {
        $or: [
          {
            hidden: false,
          },
          {
            hidden: { $exists: false },
          },
        ],
      },
    ];
    const articles = await this.articleModel
      .find({
        $and,
      })
      .exec();
    articles.forEach((a) => {
      total = total + wordCount(a.content);
    });
    return total;
  }
  async getTotalNum(includeHidden: boolean) {
    const $and: any = [
      {
        $or: [
          {
            deleted: false,
          },
          {
            deleted: { $exists: false },
          },
        ],
      },
    ];
    if (!includeHidden) {
      $and.push({
        $or: [
          {
            hidden: false,
          },
          {
            hidden: { $exists: false },
          },
        ],
      });
    }
    return await this.articleModel
      .find({
        $and,
      })
      .count();
  }

  getView(view: ArticleView) {
    let thisView: any = this.adminView;
    switch (view) {
      case 'admin':
        thisView = this.adminView;
        break;
      case 'list':
        thisView = this.listView;
        break;
      case 'public':
        thisView = this.publicView;
    }
    return thisView;
  }

  async getAll(
    view: ArticleView,
    includeHidden: boolean,
    includeDelete?: boolean,
  ): Promise<Article[]> {
    const thisView: any = view === 'list' ? this.listLookupView : this.getView(view);
    const $and: any = [];
    if (!includeDelete) {
      $and.push({
        $or: [
          {
            deleted: false,
          },
          {
            deleted: { $exists: false },
          },
        ],
      });
    }
    if (!includeHidden) {
      $and.push({
        $or: [
          {
            hidden: false,
          },
          {
            hidden: { $exists: false },
          },
        ],
      });
    }

    const articles = await this.articleModel
      .find(
        $and.length > 0
          ? {
              $and,
            }
          : undefined,
        thisView,
      )
      .sort({ createdAt: -1 })
      .exec();
    return view === 'list'
      ? (articles.map((article) => this.publicListArticle(article)) as Article[])
      : articles;
  }

  /** Only call from the AdminGuard-protected backup controller. */
  async exportForBackup(): Promise<Article[]> {
    return this.articleModel
      .find(
        {
          $or: [{ deleted: false }, { deleted: { $exists: false } }],
        },
        { ...this.adminView, password: 1 },
      )
      .select('+password')
      .sort({ createdAt: -1 })
      .exec();
  }

  async getTimeLineInfo() {
    // 肯定是不需要具体内容的，一个列表就好了
    const articles = await this.articleModel
      .find(
        {
          $and: [
            {
              $or: [
                {
                  deleted: false,
                },
                {
                  deleted: { $exists: false },
                },
              ],
            },
            {
              $or: [
                {
                  hidden: false,
                },
                {
                  hidden: { $exists: false },
                },
              ],
            },
          ],
        },
        this.listLookupView,
      )
      .sort({ createdAt: -1 })
      .exec();
    // 清洗一下数据。
    const dates = Array.from(new Set(articles.map((a) => a.createdAt.getFullYear())));
    const res: Record<string, Article[]> = {};
    dates.forEach((date) => {
      res[date] = articles
        .filter((a) => a.createdAt.getFullYear() == date)
        .map((article) => this.publicListArticle(article)) as Article[];
    });
    return res;
  }
  async getByOption(
    option: SearchArticleOption,
    isPublic: boolean,
  ): Promise<{ articles: Article[]; total: number; totalWordCount?: number }> {
    const query: any = {};
    const $and: any = [
      {
        $or: [
          {
            deleted: false,
          },
          {
            deleted: { $exists: false },
          },
        ],
      },
    ];
    const and = [];
    let sort: any = { createdAt: -1 };
    if (isPublic) {
      $and.push({
        $or: [
          {
            hidden: false,
          },
          {
            hidden: { $exists: false },
          },
        ],
      });
    }

    if (option.sortTop) {
      if (option.sortTop == 'asc') {
        sort = { top: 1 };
      } else {
        sort = { top: -1 };
      }
    }
    if (option.sortViewer) {
      if (option.sortViewer == 'asc') {
        sort = { viewer: 1 };
      } else {
        sort = { viewer: -1 };
      }
    }
    if (option.sortCreatedAt) {
      if (option.sortCreatedAt == 'asc') {
        sort = { createdAt: 1 };
      }
    }
    if (option.tags) {
      const tags = option.tags.split(',').filter(Boolean);
      if (!tags.length || tags.length > 20) {
        throw new BadRequestException('Tags query must contain 1-20 values');
      }
      const or: any = [];
      tags.forEach((t) => {
        if (option.regMatch) {
          or.push({
            tags: { $regex: escapeRegexLiteral(t), $options: 'i' },
          });
        } else {
          or.push({
            tags: t,
          });
        }
      });
      and.push({ $or: or });
    }
    if (option.category) {
      if (option.regMatch) {
        and.push({
          category: { $regex: escapeRegexLiteral(option.category), $options: 'i' },
        });
      } else {
        and.push({
          category: option.category,
        });
      }
    }
    if (option.title) {
      const title = { $regex: escapeRegexLiteral(option.title), $options: 'i' };
      and.push({ $or: [{ title }, { titleEn: title }] });
    }
    if (option.startTime || option.endTime) {
      const obj: any = {};
      if (option.startTime) {
        obj['$gte'] = new Date(option.startTime);
      }
      if (option.endTime) {
        obj['$lte'] = new Date(option.endTime);
      }
      $and.push({ createdAt: obj });
    }

    if (and.length) {
      $and.push({ $and: and });
    }

    query.$and = $and;
    // console.log(JSON.stringify(query, null, 2));
    // console.log(JSON.stringify(sort, null, 2));
    let view: any = isPublic ? this.publicView : this.adminView;
    if (option.toListView) {
      view = this.listLookupView;
    }
    if (option.withWordCount) {
      view = isPublic ? this.publicView : this.adminView;
    }
    let articlesQuery = this.articleModel.find(query, view).sort(sort);
    if (isPublic && option.pageSize != -1) {
      // Match the previous public ordering without loading and sorting the
      // whole collection in application memory.
      sort = Object.fromEntries([
        ['top', -1],
        ...Object.entries(sort).filter(([key]) => key !== 'top'),
      ]);
      articlesQuery = this.articleModel.find(query, view).sort(sort);
    }
    if (option.pageSize != -1) {
      articlesQuery = articlesQuery
        .skip(option.pageSize * option.page - option.pageSize)
        .limit(option.pageSize);
    }

    let articles = await articlesQuery.exec();
    // withWordCount 只会返回当前分页的文字数量

    const total = await this.articleModel.count(query).exec();
    // 过滤私有文章
    if (isPublic) {
      const tmpArticles: any[] = [];
      const privateCategories = await this.categoryModal
        .find({ private: true }, { name: 1, _id: 0 })
        .lean()
        .exec();
      const privateCategoryNames = new Set(privateCategories.map((category) => category.name));
      for (const a of articles) {
        //@ts-ignore
        const isPrivateInArticle = a?._doc?.private || a?.private;
        //@ts-ignore
        const isPrivateInCategory = privateCategoryNames.has(a?._doc?.category || a?.category);
        const isPrivate = isPrivateInArticle || isPrivateInCategory;
        if (isPrivate) {
          tmpArticles.push(this.protectedPublicArticle(a));
        } else {
          tmpArticles.push({
            //@ts-ignore
            ...(a?._doc || a),
          });
        }
      }
      articles = tmpArticles;
    }
    const resData: any = {};
    if (option.withWordCount) {
      let totalWordCount = 0;
      articles.forEach((a) => {
        totalWordCount = totalWordCount + wordCount(a?.content || '');
      });
      resData.totalWordCount = totalWordCount;
    }
    if (option.toListView) {
      // The lookup may select the English body internally, but list responses
      // expose only a boolean completeness marker.
      resData.articles = articles.map((article) => this.publicListArticle(article));
    } else {
      resData.articles = articles;
    }

    resData.total = total;
    return resData;
  }

  async getByIdOrPathname(id: string | number, view: ArticleView) {
    const articleByPathname = await this.getByPathName(String(id), view);

    if (articleByPathname) {
      return articleByPathname;
    }
    return await this.getById(Number(id), view);
  }

  async getByPathName(pathname: string, view: ArticleView): Promise<Article> {
    let normalizedPathname: string;
    try {
      normalizedPathname = this.normalizeArticlePathname(pathname);
    } catch {
      return null;
    }
    if (!normalizedPathname) return null;

    const $and: any = [
      {
        $or: [
          {
            deleted: false,
          },
          {
            deleted: { $exists: false },
          },
        ],
      },
    ];

    const article = await this.articleModel
      .findOne(
        {
          pathname: normalizedPathname,
          $and,
        },
        view === 'list' ? this.listLookupView : this.getView(view),
      )
      .exec();
    return view === 'list' && article
      ? (this.publicListArticle(article) as Article)
      : article;
  }

  async getById(id: number, view: ArticleView): Promise<Article> {
    const $and: any = [
      {
        $or: [
          {
            deleted: false,
          },
          {
            deleted: { $exists: false },
          },
        ],
      },
    ];

    const article = await this.articleModel
      .findOne(
        {
          id,
          $and,
        },
        view === 'list' ? this.listLookupView : this.getView(view),
      )
      .exec();
    return view === 'list' && article
      ? (this.publicListArticle(article) as Article)
      : article;
  }
  async getByIdWithPassword(id: number | string, password: string): Promise<any> {
    if (!isValidContentPasswordLength(password)) {
      return null;
    }
    let pathname: string;
    try {
      pathname = this.normalizeArticlePathname(String(id));
    } catch {
      return null;
    }
    const articleByPathname: any = pathname
      ? await this.articleModel
          .findOne({
            pathname,
            $or: [{ deleted: false }, { deleted: { $exists: false } }],
          })
          .select('+password')
          .exec()
      : null;
    const numericId = Number(id);
    const article: any =
      articleByPathname ||
      (Number.isFinite(numericId)
        ? await this.articleModel
            .findOne({
              id: numericId,
              $or: [{ deleted: false }, { deleted: { $exists: false } }],
            })
            .select('+password')
            .exec()
        : null);
    if (!article) {
      return null;
    }

    if (article.hidden) {
      const siteInfo = await this.metaProvider.getSiteInfo();
      if (!siteInfo?.allowOpenHiddenPostByUrl || siteInfo.allowOpenHiddenPostByUrl == 'false') {
        throw new NotFoundException('该文章是隐藏文章！');
      }
    }

    const category: any = await this.categoryModal
      .findOne({ name: article.category })
      .select('+password')
      .exec();
    const categoryProtectsArticle = Boolean(category?.private);
    const articleProtectsItself = Boolean(article.private);
    const protectedRecord = categoryProtectsArticle
      ? category
      : articleProtectsItself
        ? article
        : null;
    const storedPassword = protectedRecord?.password;

    if (protectedRecord) {
      if (!hasContentPassword(storedPassword)) return null;
      const verification = await verifyContentPassword(password, storedPassword);
      if (!verification.valid) return null;

      if (verification.needsRehash) {
        const migratedPassword = await hashContentPassword(password);
        if (categoryProtectsArticle) {
          await this.categoryModal.updateOne(
            { _id: category._id },
            { $set: { password: migratedPassword } },
          );
        } else {
          await this.articleModel.updateOne(
            { _id: article._id },
            { $set: { password: migratedPassword } },
          );
        }
      }
    }

    const result = { ...(article?.toObject?.() || article?._doc || article) };
    delete result.password;
    delete result._id;
    delete result.__v;
    delete result.deleted;
    return result;
  }
  async getByIdOrPathnameWithPreNext(id: string | number, view: ArticleView) {
    const curArticle = await this.getByIdOrPathname(id, view);
    if (!curArticle) {
      throw new NotFoundException('找不到文章');
    }

    if (curArticle.hidden) {
      const siteInfo = await this.metaProvider.getSiteInfo();
      if (!siteInfo?.allowOpenHiddenPostByUrl || siteInfo?.allowOpenHiddenPostByUrl == 'false') {
        throw new NotFoundException('该文章是隐藏文章！');
      }
    }
    const articleRecord = this.articleRecord(curArticle);
    const hasEnglishVersion = this.hasCompleteEnglishVersion(articleRecord);
    let requiresPassword = Boolean(curArticle.private);
    if (!requiresPassword) {
      // 检查分类是不是加密了
      const category = await this.categoryModal.findOne({
        name: curArticle.category,
      });
      if (category && category.private) {
        requiresPassword = true;
      }
    }
    const publicArticle = requiresPassword
      ? this.protectedPublicArticle(articleRecord)
      : articleRecord;
    const res: any = {
      article: { ...publicArticle, hasEnglishVersion },
    };
    // 找它的前一个和后一个。
    const preArticle = await this.getPreArticleByArticle(curArticle, 'list');
    const nextArticle = await this.getNextArticleByArticle(curArticle, 'list');
    if (preArticle) {
      res.pre = preArticle;
    }
    if (nextArticle) {
      res.next = nextArticle;
    }
    return res;
  }
  async getPreArticleByArticle(article: Article, _view: ArticleView, includeHidden?: boolean) {
    const $and: any = [
      {
        $or: [
          {
            deleted: false,
          },
          {
            deleted: { $exists: false },
          },
        ],
      },
      { createdAt: { $lt: article.createdAt } },
    ];
    if (!includeHidden) {
      $and.push({
        $or: [
          {
            hidden: false,
          },
          {
            hidden: { $exists: false },
          },
        ],
      });
    }
    const result = await this.articleModel
      .find(
        {
          $and,
        },
        this.neighborLookupView,
      )
      .sort({ createdAt: -1 })
      .limit(1);
    if (result.length) {
      return this.publicNeighbor(result[0]);
    }
    return null;
  }
  async getNextArticleByArticle(article: Article, _view: ArticleView, includeHidden?: boolean) {
    const $and: any = [
      {
        $or: [
          {
            deleted: false,
          },
          {
            deleted: { $exists: false },
          },
        ],
      },
      { createdAt: { $gt: article.createdAt } },
    ];
    if (!includeHidden) {
      $and.push({
        $or: [
          {
            hidden: false,
          },
          {
            hidden: { $exists: false },
          },
        ],
      });
    }
    const result = await this.articleModel
      .find(
        {
          $and,
        },
        this.neighborLookupView,
      )
      .sort({ createdAt: 1 })
      .limit(1);
    if (result.length) {
      return this.publicNeighbor(result[0]);
    }
    return null;
  }

  async findOneByTitle(title: string): Promise<Article> {
    return this.articleModel.findOne({ title }).exec();
  }

  toSearchResult(articles: Article[]) {
    return articles.map((each) => ({
      title: each.title,
      titleEn: each.titleEn,
      summary: each.summary,
      summaryEn: each.summaryEn,
      hasEnglishVersion: this.hasCompleteEnglishVersion(each),
      id: each.id,
      category: each.category,
      tags: each.tags,
      updatedAt: each.updatedAt,
      createdAt: each.createdAt,
    }));
  }

  async searchByString(str: string, includeHidden: boolean): Promise<Article[]> {
    const safeSearch = escapeRegexLiteral(str);
    const privateCategories = await this.categoryModal
      .find({ private: true }, { name: 1, _id: 0 })
      .lean()
      .exec();
    const privateCategoryNames = new Set<string>(
      privateCategories
        .map((category) => category?.name)
        .filter((name): name is string => typeof name === 'string'),
    );
    const $and: any = [
      {
        $or: [
          { content: { $regex: safeSearch, $options: 'i' } },
          { contentEn: { $regex: safeSearch, $options: 'i' } },
          { summary: { $regex: safeSearch, $options: 'i' } },
          { summaryEn: { $regex: safeSearch, $options: 'i' } },
          { title: { $regex: safeSearch, $options: 'i' } },
          { titleEn: { $regex: safeSearch, $options: 'i' } },
          { category: { $regex: safeSearch, $options: 'i' } },
          { tags: { $regex: safeSearch, $options: 'i' } },
        ],
      },
      {
        $or: [
          {
            deleted: false,
          },
          {
            deleted: { $exists: false },
          },
        ],
      },
      {
        $or: [{ private: false }, { private: { $exists: false } }],
      },
    ];
    if (privateCategoryNames.size) {
      $and.push({ category: { $nin: Array.from(privateCategoryNames) } });
    }
    if (!includeHidden) {
      $and.push({
        $or: [
          {
            hidden: false,
          },
          {
            hidden: { $exists: false },
          },
        ],
      });
    }
    const rawData = await this.articleModel
      .find({
        $and,
      })
      .limit(100)
      .maxTimeMS(2_000)
      .exec();
    // Keep a second application-level guard so a stale/incomplete database
    // query cannot accidentally turn protected matches into public results.
    const publicData = rawData.filter(
      (each) => !each.private && !privateCategoryNames.has(each.category),
    );
    const s = str.toLocaleLowerCase();
    const titleData = publicData.filter((each) =>
      [each.title, each.titleEn].some(
        (value) => typeof value === 'string' && value.toLocaleLowerCase().includes(s),
      ),
    );
    const contentData = publicData.filter((each) =>
      [each.content, each.contentEn, each.summary, each.summaryEn].some(
        (value) => typeof value === 'string' && value.toLocaleLowerCase().includes(s),
      ),
    );
    const categoryData = publicData.filter((each) => each.category.toLocaleLowerCase().includes(s));
    const tagData = publicData.filter((each) =>
      each.tags.map((t) => t.toLocaleLowerCase()).includes(s),
    );
    const sortedData = [...titleData, ...contentData, ...tagData, ...categoryData];
    const resData = [];
    for (const e of sortedData) {
      if (!resData.includes(e)) {
        resData.push(e);
      }
    }
    return resData;
  }

  async findAll(): Promise<Article[]> {
    return this.articleModel.find({}).exec();
  }
  async deleteById(id: number) {
    const res = await this.articleModel.updateOne({ id }, { deleted: true }).exec();
    this.metaProvider.updateTotalWords('删除文章');
    return res;
  }

  async updateById(
    id: number,
    updateArticleDto: UpdateArticleDto,
    skipUpdateWordCount?: boolean,
    trustedImportPasswordHash = false,
  ) {
    const updateData = { ...(updateArticleDto as any) } as UpdateArticleDto &
      Record<string, unknown>;
    this.assertNoBodyIdentityFields(updateData);
    assertLocalizedArticleFields(updateData);
    if (updateData.pathname !== undefined) {
      updateData.pathname = this.normalizeArticlePathname(updateData.pathname);
    }

    const operation = async () => {
      const existing: any = await this.articleModel
        .findOne({ id }, { private: 1, password: 1, pathname: 1 })
        .select('+password')
        .exec();
      if (!existing) {
        throw new NotFoundException('Article not found');
      }

      if (updateData.private !== undefined && typeof updateData.private !== 'boolean') {
        throw new BadRequestException('Article private must be a boolean');
      }
      if (updateData.password !== undefined && typeof updateData.password !== 'string') {
        throw new BadRequestException('Article password must be a string');
      }
      const existingPathname = typeof existing.pathname === 'string' ? existing.pathname : '';
      if (updateData.pathname && updateData.pathname !== existingPathname) {
        await this.assertPathnameNamespaceAvailable(id, updateData.pathname, false);
      }

      const nextPrivate =
        typeof updateData.private === 'boolean' ? updateData.private : Boolean(existing.private);
      const newPasswordProvided = hasContentPassword(updateData.password);

      if (newPasswordProvided && !isValidContentPasswordLength(updateData.password)) {
        throw new BadRequestException(
          `Content password must contain at most ${MAX_CONTENT_PASSWORD_LENGTH} characters`,
        );
      }

      const update: any = {
        $set: {
          ...updateData,
          updatedAt: updateData.updatedAt || new Date(),
        },
      };
      delete update.$set.password;

      if (!nextPrivate) {
        update.$unset = { password: 1 };
      } else if (newPasswordProvided) {
        update.$set.password =
          trustedImportPasswordHash && isScryptPasswordHash(updateData.password)
            ? updateData.password
            : await hashContentPassword(updateData.password);
      } else if (!hasContentPassword(existing.password)) {
        throw new BadRequestException('Private articles require a password');
      }

      const res = await this.articleModel.updateOne({ id }, update);
      if (!skipUpdateWordCount) {
        this.metaProvider.updateTotalWords('更新文章');
      }
      return res;
    };

    return updateData.pathname !== undefined ? this.withIdentityWriteLock(operation) : operation();
  }

  async getNewId() {
    while (this.idLock) {
      await sleep(10);
    }
    this.idLock = true;
    try {
      const maxObj = await this.articleModel.find({}).sort({ id: -1 }).limit(1);
      let res = 1;
      if (maxObj.length) {
        res = maxObj[0].id + 1;
      }
      return res;
    } finally {
      // A transient database error must not leave every later article create
      // spinning forever behind a stale in-process lock.
      this.idLock = false;
    }
  }
}
