import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { Connection, Model, Types } from 'mongoose';
import { config } from 'src/config';
import { Article, ArticleDocument } from 'src/scheme/article.schema';
import { Category, CategoryDocument } from 'src/scheme/category.schema';
import { Comment, CommentDocument } from 'src/scheme/comment.schema';
import { CommentReaction, CommentReactionDocument } from 'src/scheme/commentReaction.schema';
import {
  CommentMigrationTombstone,
  CommentMigrationTombstoneDocument,
} from 'src/scheme/commentMigrationTombstone.schema';
import {
  CommentStatus,
  CommentRequestMetadata,
  CreateCommentDto,
  ModeratableCommentStatus,
  PublicCommentDto,
} from 'src/types/comment.dto';
import {
  normalizeCommentContent,
  normalizeCommentEmail,
  normalizeCommentId,
  normalizeCommentLink,
  normalizeCommentPath,
  normalizeCreateComment,
  COMMENT_STORED_CONTENT_MAX_LENGTH,
} from 'src/utils/comment';
import { escapeRegexLiteral } from 'src/utils/safeRegex';
import { buildPublicCommentTree, serializePublicComment } from 'src/utils/commentPublic';
import { MetaProvider } from '../meta/meta.provider';
import { SettingProvider } from '../setting/setting.provider';
import { CommentClientInfoProvider } from './clientInfo.provider';

const PUBLIC_REPLY_LIMIT = 1_000;
const MAX_REPLIES_PER_ROOT = 100;
const PUBLIC_ROOT_LIMIT = Math.floor(PUBLIC_REPLY_LIMIT / MAX_REPLIES_PER_ROOT);
const MAX_REPLY_DEPTH = 8;
const MAX_MODERATION_DESCENDANTS = 10_000;
const MAX_MIGRATION_COMMENTS = 100_000;
const DUPLICATE_WINDOW_MS = 10 * 60_000;

function backupMetadataString(value: unknown, maxLength: number, fallback: string): string {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') throw new Error('Invalid comment client metadata');
  const normalized = value.trim();
  if (
    normalized.length > maxLength ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new Error('Invalid comment client metadata');
  }
  return normalized || fallback;
}

type CommentRecord = Partial<Comment> & {
  _id: Types.ObjectId;
  mail?: string;
  articleId?: number;
  legacyId?: string;
};

export interface ResolvedCommentTarget {
  path: string;
  articleId?: number;
  aliases: string[];
}

export interface PublicCommentList {
  items: PublicCommentDto[];
  total: number;
  page: number;
  pageSize: number;
  maxLength: number;
  truncatedReplies?: boolean;
}

@Injectable()
export class CommentProvider {
  constructor(
    @InjectModel(Comment.name) private readonly commentModel: Model<CommentDocument>,
    @InjectModel(Article.name) private readonly articleModel: Model<ArticleDocument>,
    @InjectModel(Category.name) private readonly categoryModel: Model<CategoryDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly settingProvider: SettingProvider,
    private readonly metaProvider: MetaProvider,
    @InjectModel(CommentMigrationTombstone.name)
    private readonly tombstoneModel: Model<CommentMigrationTombstoneDocument>,
    @Optional()
    @InjectModel(CommentReaction.name)
    private readonly reactionModel?: Model<CommentReactionDocument>,
    @Optional()
    private readonly clientInfoProvider?: CommentClientInfoProvider,
  ) {}

  private async clientInfo(metadata?: CommentRequestMetadata) {
    if (this.clientInfoProvider) {
      return this.clientInfoProvider.inspect(metadata?.ip, metadata?.ua);
    }
    return {
      ip: String(metadata?.ip || 'unknown').slice(0, 128),
      ua: String(metadata?.ua || '').slice(0, 512),
      location: '未知地区',
      browser: '未知浏览器',
      os: '未知系统',
    };
  }

  private async resolveTargets(
    pathValues: unknown[],
    publicOnly: boolean,
    includeDeleted = false,
  ): Promise<Map<string, ResolvedCommentTarget>> {
    const paths = [...new Set(pathValues.map(normalizeCommentPath))];
    const result = new Map<string, ResolvedCommentTarget>();
    const siteInfo = await this.metaProvider.getSiteInfo();
    if (publicOnly && String(siteInfo?.enableComment ?? 'true') === 'false') return result;

    for (const path of paths) {
      if (path === '/about' || path === '/link') {
        result.set(path, { path, aliases: [path] });
      }
    }

    const postEntries = paths
      .map((path) => ({ path, match: /^\/post\/([^/]+)$/u.exec(path) }))
      .filter((entry): entry is { path: string; match: RegExpExecArray } => Boolean(entry.match));
    if (postEntries.length === 0) return result;

    const identifiers = [...new Set(postEntries.map((entry) => entry.match[1]))];
    const numericIds = identifiers
      .map((identifier) => Number(identifier))
      .filter((id) => Number.isSafeInteger(id) && id >= 0);
    const articles: any[] = await this.articleModel
      .find(
        {
          $and: [
            ...(includeDeleted
              ? []
              : [{ $or: [{ deleted: false }, { deleted: { $exists: false } }] }]),
            {
              $or: [
                { pathname: { $in: identifiers } },
                ...(numericIds.length > 0 ? [{ id: { $in: numericIds } }] : []),
              ],
            },
          ],
        },
        { id: 1, pathname: 1, category: 1, private: 1, hidden: 1, _id: 0 },
      )
      .lean()
      .maxTimeMS(2_000)
      .exec();

    const privateCategoryNames = new Set<string>();
    if (publicOnly && articles.length > 0) {
      const categoryNames = [
        ...new Set(articles.map((article) => String(article.category || '')).filter(Boolean)),
      ];
      if (categoryNames.length > 0) {
        const privateCategories = await this.categoryModel
          .find({ name: { $in: categoryNames }, private: true }, { name: 1, _id: 0 })
          .lean()
          .maxTimeMS(2_000)
          .exec();
        for (const category of privateCategories) privateCategoryNames.add(category.name);
      }
    }

    const hiddenAllowed = String(siteInfo?.allowOpenHiddenPostByUrl ?? 'false') === 'true';
    for (const entry of postEntries) {
      const identifier = entry.match[1];
      // Match the article endpoint: an explicit pathname takes precedence over
      // the numeric-id fallback.
      const pathnameMatches = articles.filter((item) => String(item.pathname || '') === identifier);
      // Duplicate pathnames are ambiguous and the article endpoint's findOne
      // result would be order-dependent. Fail closed instead of exposing a
      // different article's comment history.
      const article =
        pathnameMatches.length === 1
          ? pathnameMatches[0]
          : pathnameMatches.length > 1
            ? null
            : articles.find((item) => Number(item.id) === Number(identifier));
      if (!article) continue;
      if (
        publicOnly &&
        (Boolean(article.private) ||
          privateCategoryNames.has(String(article.category || '')) ||
          (Boolean(article.hidden) && !hiddenAllowed))
      ) {
        continue;
      }
      const aliases = new Set<string>([entry.path, `/post/${article.id}`]);
      if (article.pathname) {
        try {
          aliases.add(normalizeCommentPath(`/post/${article.pathname}`));
        } catch {
          // An old invalid slug may still be reachable by numeric id. Do not
          // let it poison validation of that stable route.
        }
      }
      result.set(entry.path, {
        path: entry.path,
        articleId: Number(article.id),
        aliases: [...aliases],
      });
    }
    return result;
  }

  async assertPublicTarget(pathValue: unknown): Promise<ResolvedCommentTarget> {
    const path = normalizeCommentPath(pathValue);
    const target = (await this.resolveTargets([path], true)).get(path);
    if (!target) throw new NotFoundException('Comment target is unavailable');
    return target;
  }

  private async assertPublicArticleId(articleId: number): Promise<ResolvedCommentTarget> {
    const siteInfo = await this.metaProvider.getSiteInfo();
    if (String(siteInfo?.enableComment ?? 'true') === 'false') {
      throw new NotFoundException('Comment target is unavailable');
    }
    const article: any = await this.articleModel
      .findOne(
        {
          id: articleId,
          $or: [{ deleted: false }, { deleted: { $exists: false } }],
        },
        { id: 1, pathname: 1, category: 1, private: 1, hidden: 1, _id: 0 },
      )
      .lean()
      .maxTimeMS(2_000)
      .exec();
    if (!article) throw new NotFoundException('Comment target is unavailable');
    const privateCategory = await this.categoryModel
      .findOne({ name: article.category, private: true }, { _id: 1 })
      .lean()
      .maxTimeMS(2_000)
      .exec();
    const hiddenAllowed = String(siteInfo?.allowOpenHiddenPostByUrl ?? 'false') === 'true';
    if (article.private || privateCategory || (article.hidden && !hiddenAllowed)) {
      throw new NotFoundException('Comment target is unavailable');
    }
    const path = `/post/${articleId}`;
    const aliases = new Set([path]);
    if (article.pathname) {
      try {
        aliases.add(normalizeCommentPath(`/post/${article.pathname}`));
      } catch {
        // The stable numeric id remains valid even if an imported slug is not.
      }
    }
    return { path, articleId, aliases: [...aliases] };
  }

  private async resolveStoredTarget(pathValue: unknown): Promise<ResolvedCommentTarget | null> {
    const path = normalizeCommentPath(pathValue);
    return (await this.resolveTargets([path], false, true)).get(path) || null;
  }

  private targetFilter(target: ResolvedCommentTarget): Record<string, unknown> {
    if (target.articleId === undefined) {
      return { path: target.path, quarantined: { $ne: true } };
    }
    return {
      $and: [
        { quarantined: { $ne: true } },
        {
          $or: [
            { articleId: target.articleId },
            {
              $and: [
                { path: target.path },
                { $or: [{ articleId: { $exists: false } }, { articleId: null }] },
              ],
            },
          ],
        },
      ],
    };
  }

  private async assertPublicRecord(comment: CommentRecord): Promise<ResolvedCommentTarget> {
    if (comment.quarantined) throw new NotFoundException('Comment not found');
    if (Number.isSafeInteger(comment.articleId) && Number(comment.articleId) >= 0) {
      return this.assertPublicArticleId(Number(comment.articleId));
    }
    return this.assertPublicTarget(comment.path);
  }

  private duplicateKeys(
    input: ReturnType<typeof normalizeCreateComment>,
    target: ResolvedCommentTarget,
  ): string[] {
    const bucket = Math.floor(Date.now() / DUPLICATE_WINDOW_MS);
    const identity = JSON.stringify([
      target.articleId === undefined ? target.path : `article:${target.articleId}`,
      input.replyToId || '',
      input.content,
      input.nick,
      input.mail,
    ]);
    return [bucket, bucket - 1].map((value) =>
      createHash('sha256').update(`${value}\0${identity}`, 'utf8').digest('hex'),
    );
  }

  private async replyDepth(parent: CommentRecord): Promise<number> {
    let depth = 1;
    let current = parent;
    const visited = new Set([String(parent._id)]);
    while (current.parentId) {
      if (depth >= MAX_REPLY_DEPTH) {
        throw new BadRequestException(`Replies may be nested at most ${MAX_REPLY_DEPTH} levels`);
      }
      const parentId = String(current.parentId);
      if (visited.has(parentId)) throw new BadRequestException('Invalid comment reply chain');
      visited.add(parentId);
      const next = await this.commentModel.findById(parentId).lean().exec();
      if (!next) throw new BadRequestException('The parent comment is unavailable');
      current = next;
      depth += 1;
    }
    return depth;
  }

  private isThreadPositionConflict(error: any): boolean {
    if (error?.code !== 11000) return false;
    return Boolean(
      error?.keyPattern?.threadPosition ||
        String(error?.message || '').includes('rootId_1_threadPosition_1'),
    );
  }

  /**
   * Assign deterministic slots to pre-slot migration/backup replies. The
   * unique compound index resolves concurrent backfills safely.
   */
  private async ensureThreadPositions(rootId: Types.ObjectId): Promise<number> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const replies: any[] = await this.commentModel
        .find({ rootId }, { _id: 1, threadPosition: 1 })
        .sort({ createdAt: 1, _id: 1 })
        .limit(MAX_REPLIES_PER_ROOT + 1)
        .lean()
        .maxTimeMS(2_000)
        .exec();
      const used = new Set(
        replies
          .map((reply) => Number(reply.threadPosition))
          .filter(
            (position) =>
              Number.isInteger(position) && position >= 1 && position <= MAX_REPLIES_PER_ROOT,
          ),
      );
      const available = Array.from(
        { length: MAX_REPLIES_PER_ROOT },
        (_, index) => index + 1,
      ).filter((position) => !used.has(position));
      const missing = replies.filter(
        (reply) =>
          !Number.isInteger(Number(reply.threadPosition)) ||
          Number(reply.threadPosition) < 1 ||
          Number(reply.threadPosition) > MAX_REPLIES_PER_ROOT,
      );
      let raced = false;
      const assignments = Math.min(missing.length, available.length);
      for (let index = 0; index < assignments; index += 1) {
        try {
          await this.commentModel
            .updateOne(
              {
                _id: missing[index]._id,
                rootId,
                $or: [{ threadPosition: { $exists: false } }, { threadPosition: null }],
              },
              { $set: { threadPosition: available[index] } },
            )
            .exec();
        } catch (error) {
          if (!this.isThreadPositionConflict(error)) throw error;
          raced = true;
          break;
        }
      }
      if (!raced) return replies.length;
    }
    return this.commentModel.countDocuments({ rootId }).maxTimeMS(2_000).exec();
  }

  private async createCommentDocument(
    document: Record<string, unknown>,
    rootId: Types.ObjectId | null,
  ): Promise<CommentDocument> {
    if (!rootId) return this.commentModel.create(document);
    for (let threadPosition = 1; threadPosition <= MAX_REPLIES_PER_ROOT; threadPosition += 1) {
      try {
        return await this.commentModel.create({ ...document, threadPosition });
      } catch (error: any) {
        if (this.isThreadPositionConflict(error)) continue;
        if (error?.code === 11000) throw new ConflictException('Duplicate comment');
        throw error;
      }
    }
    throw new BadRequestException(`A thread may contain at most ${MAX_REPLIES_PER_ROOT} replies`);
  }

  /**
   * A reply can race with moderation after its parent was first read. Keep
   * normal deletion as a scrubbed placeholder, and roll back a just-created
   * reply if the direct parent is no longer approved. Together these two
   * operations prevent an orphan even when permanent cleanup is concurrent.
   */
  private async retainReplyOnlyWhileParentApproved(
    created: CommentDocument,
    parentId: Types.ObjectId,
  ): Promise<void> {
    const parentStillApproved = await this.commentModel
      .exists({ _id: parentId, status: 'approved' })
      .exec();
    if (parentStillApproved) return;
    await this.commentModel.deleteOne({ _id: created._id }).exec();
    throw new BadRequestException('The parent comment became unavailable');
  }

  private initialStatus(content: string, moderation: 'all' | 'suspicious' | 'off'): CommentStatus {
    const forbiddenWords = (process.env.ZWEI_BLOG_COMMENT_FORBIDDEN_WORDS || '')
      .split(',')
      .map((word) => word.trim().toLocaleLowerCase())
      .filter(Boolean)
      .slice(0, 500);
    const normalizedContent = content.toLocaleLowerCase();
    if (forbiddenWords.some((word) => normalizedContent.includes(word))) return 'spam';
    if (moderation === 'all') return 'pending';
    if (moderation === 'off') return 'approved';
    const linkCount = (content.match(/https?:\/\/[^\s<>()]+/giu) || []).length;
    const repeatedRun = /(.)\1{15,}/u.test(content);
    return linkCount >= 3 || repeatedRun ? 'pending' : 'approved';
  }

  private toPublic(comment: CommentRecord): PublicCommentDto {
    return serializePublicComment(comment);
  }

  private toAdmin(comment: CommentRecord) {
    return {
      id: String(comment._id),
      content: String(comment.content || ''),
      path: String(comment.path || ''),
      articleId:
        Number.isSafeInteger(comment.articleId) && Number(comment.articleId) >= 0
          ? Number(comment.articleId)
          : undefined,
      quarantined: Boolean(comment.quarantined),
      parentId: comment.rootId ? String(comment.rootId) : null,
      replyToId: comment.parentId ? String(comment.parentId) : null,
      likes: Math.max(0, Number(comment.likes) || 0),
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      nick: String(comment.nick || ''),
      mail: String(comment.mail || ''),
      link: String(comment.link || ''),
      status: comment.status,
      isAdmin: Boolean(comment.isAdmin),
      ip: String(comment.ip || ''),
      ua: String(comment.ua || ''),
      location: String(comment.location || '未知地区'),
      browser: String(comment.browser || '未知浏览器'),
      os: String(comment.os || '未知系统'),
    };
  }

  async create(
    body: CreateCommentDto,
    verifiedTarget?: ResolvedCommentTarget,
    beforeInsert?: () => Promise<void>,
    metadata?: CommentRequestMetadata,
  ) {
    const input = normalizeCreateComment(body);
    const target = verifiedTarget || (await this.assertPublicTarget(input.path));
    if (target.path !== input.path) throw new BadRequestException('Comment target mismatch');
    const setting = await this.settingProvider.getCommentSetting();
    if (input.content.length > setting.maxLength) {
      throw new BadRequestException(`Comment content exceeds ${setting.maxLength} characters`);
    }
    let parent: CommentRecord | null = null;
    if (input.replyToId) {
      parent = await this.commentModel
        .findOne({
          $and: [{ _id: input.replyToId, status: 'approved' }, this.targetFilter(target)],
        })
        .lean()
        .exec();
      if (!parent) throw new BadRequestException('The parent comment is unavailable');
      await this.replyDepth(parent);
      const rootId = parent.rootId || parent._id;
      const replyCount = await this.ensureThreadPositions(rootId);
      if (replyCount >= MAX_REPLIES_PER_ROOT) {
        throw new BadRequestException(
          `A thread may contain at most ${MAX_REPLIES_PER_ROOT} replies`,
        );
      }
    }

    const status = this.initialStatus(input.content, setting.moderation);
    const clientInfo = await this.clientInfo(metadata);
    // Shared target quotas are reserved only after all cheap/body/thread
    // validation succeeds, but immediately before the atomic insert.
    if (beforeInsert) await beforeInsert();
    let created: CommentDocument;
    try {
      const rootId = parent ? parent.rootId || parent._id : null;
      created = await this.createCommentDocument(
        {
          ...input,
          ...(target.articleId === undefined ? {} : { articleId: target.articleId }),
          parentId: parent?._id || null,
          rootId,
          status,
          ...clientInfo,
          duplicateKeys: this.duplicateKeys(input, target),
        },
        rootId,
      );
    } catch (error: any) {
      if (error?.code === 11000) {
        throw new ConflictException('Duplicate comment');
      }
      throw error;
    }
    if (parent) await this.retainReplyOnlyWhileParentApproved(created, parent._id);
    return {
      comment: this.toPublic(created.toObject()),
      moderated: status !== 'approved',
    };
  }

  async listPublic(
    pathValue: unknown,
    page: number,
    pageSize: number,
    actorHash?: string,
  ): Promise<PublicCommentList> {
    const target = await this.assertPublicTarget(pathValue);
    const setting = await this.settingProvider.getCommentSetting();
    const effectivePageSize = Math.min(pageSize, setting.pageSize, PUBLIC_ROOT_LIMIT);
    const targetFilter = this.targetFilter(target);
    // Keep deleted roots only when an approved descendant still needs their
    // structural placeholder. Resolve that existence inside MongoDB instead
    // of materialising every matching rootId in Node (Mongo distinct results
    // are capped at 16 MB and could otherwise make a busy page permanently
    // fail). The facet returns only the requested page plus one scalar count.
    const rootPage = await this.commentModel
      .aggregate<{ metadata: Array<{ total: number }>; items: CommentRecord[] }>([
        {
          $match: {
            $and: [targetFilter, { parentId: null }, { status: { $in: ['approved', 'deleted'] } }],
          },
        },
        {
          $lookup: {
            from: 'comments',
            let: { rootCommentId: '$_id' },
            pipeline: [
              {
                $match: {
                  $and: [
                    targetFilter,
                    { status: 'approved' },
                    { $expr: { $eq: ['$rootId', '$$rootCommentId'] } },
                  ],
                },
              },
              { $limit: 1 },
              { $project: { _id: 1 } },
            ],
            as: '_visibleReplies',
          },
        },
        {
          $match: {
            $or: [
              { status: 'approved' },
              { status: 'deleted', '_visibleReplies.0': { $exists: true } },
            ],
          },
        },
        { $sort: { createdAt: -1, _id: -1 } },
        {
          $facet: {
            metadata: [{ $count: 'total' }],
            items: [
              { $skip: (page - 1) * effectivePageSize },
              { $limit: effectivePageSize },
              { $unset: '_visibleReplies' },
            ],
          },
        },
      ])
      .option({ maxTimeMS: 2_000 })
      .exec();
    const roots = rootPage[0]?.items || [];
    const total = rootPage[0]?.metadata?.[0]?.total || 0;
    if (roots.length === 0) {
      return {
        items: [],
        total,
        page,
        pageSize: effectivePageSize,
        maxLength: setting.maxLength,
      };
    }

    const rootIds = roots.map((root) => root._id);
    const replies = await this.commentModel
      .find({
        $and: [
          targetFilter,
          { status: { $in: ['approved', 'deleted'] }, rootId: { $in: rootIds } },
        ],
      })
      .sort({ createdAt: 1, _id: 1 })
      .limit(PUBLIC_REPLY_LIMIT + 1)
      .lean()
      .maxTimeMS(2_000)
      .exec();

    const publicRoots = buildPublicCommentTree(
      roots,
      replies.slice(0, PUBLIC_REPLY_LIMIT),
      MAX_REPLY_DEPTH,
    );

    if (actorHash && this.reactionModel) {
      const ids = [...roots, ...replies.slice(0, PUBLIC_REPLY_LIMIT)].map((item) => item._id);
      const reactions = await this.reactionModel
        .find({ commentId: { $in: ids }, actorHash }, { commentId: 1 })
        .lean()
        .exec();
      const likedIds = new Set(reactions.map((reaction) => String(reaction.commentId)));
      const annotate = (comment: PublicCommentDto) => {
        comment.liked = likedIds.has(comment.id);
        comment.replies.forEach(annotate);
      };
      publicRoots.forEach(annotate);
    }

    return {
      items: publicRoots,
      total,
      page,
      pageSize: effectivePageSize,
      maxLength: setting.maxLength,
      ...(replies.length > PUBLIC_REPLY_LIMIT ? { truncatedReplies: true } : {}),
    };
  }

  async countPublic(paths: string[]): Promise<Record<string, number>> {
    const result: Record<string, number> = Object.fromEntries(paths.map((path) => [path, 0]));
    const targets = await this.resolveTargets(paths, true);
    if (targets.size === 0) return result;
    const targetFilters = [...targets.values()].map((target) => this.targetFilter(target));
    const counts = await this.commentModel
      .aggregate<{ _id: { path: string; articleId?: number }; count: number }>([
        { $match: { $and: [{ status: 'approved' }, { $or: targetFilters }] } },
        {
          $group: {
            _id: { path: '$path', articleId: '$articleId' },
            count: { $sum: 1 },
          },
        },
      ])
      .option({ maxTimeMS: 2_000 })
      .exec();
    for (const [path, target] of targets) {
      result[path] = counts.reduce((total, item) => {
        if (
          target.articleId !== undefined &&
          item._id.articleId !== undefined &&
          Number(item._id.articleId) === target.articleId
        ) {
          return total + item.count;
        }
        if (item._id.articleId == null && item._id.path === target.path) {
          return total + item.count;
        }
        return total;
      }, 0);
    }
    return result;
  }

  async assertLikeable(idValue: unknown): Promise<string> {
    const id = normalizeCommentId(idValue, true);
    const comment = await this.commentModel.findOne({ _id: id, status: 'approved' }).lean().exec();
    if (!comment) throw new NotFoundException('Comment not found');
    await this.assertPublicRecord(comment);
    return id;
  }

  async like(
    idValue: unknown,
    actorHash: string,
  ): Promise<{ id: string; likes: number; liked: boolean }> {
    const id = await this.assertLikeable(idValue);
    if (!this.reactionModel || !/^[a-f0-9]{64}$/u.test(actorHash)) {
      throw new ServiceUnavailableException('Comment reactions are unavailable');
    }
    const existing = await this.reactionModel
      .findOne({ commentId: id, actorHash })
      .select('+actorHash')
      .lean()
      .exec();
    let liked: boolean;
    if (existing) {
      await this.reactionModel.deleteOne({ _id: existing._id }).exec();
      liked = false;
    } else {
      try {
        await this.reactionModel.create({ commentId: id, actorHash });
        liked = true;
      } catch (error: any) {
        // A mixed-version deployment can briefly race despite the distributed
        // maintenance lock. Treat the unique record as the source of truth.
        if (error?.code !== 11000) throw error;
        liked = true;
      }
    }
    const comment = await this.commentModel
      .findOneAndUpdate(
        {
          _id: id,
          status: 'approved',
          ...(liked ? {} : { likes: { $gt: 0 } }),
        },
        { $inc: { likes: liked ? 1 : -1 } },
        { new: true },
      )
      .lean()
      .exec();
    if (!comment) {
      // Restore the reaction record if the comment became unavailable or an
      // old inconsistent count prevented cancellation.
      if (liked) {
        await this.reactionModel.deleteOne({ commentId: id, actorHash }).exec();
      } else {
        await this.reactionModel.create({ commentId: id, actorHash }).catch(() => undefined);
      }
      throw new NotFoundException('Comment not found');
    }
    return {
      id: String(comment._id),
      likes: Math.max(0, Number(comment.likes) || 0),
      liked,
    };
  }

  async listAdmin(options: {
    page: number;
    pageSize: number;
    status?: CommentStatus;
    path?: string;
    search?: string;
  }) {
    const filter: Record<string, unknown> = {};
    if (options.status) filter.status = options.status;
    if (options.path) filter.path = normalizeCommentPath(options.path);
    if (options.search) {
      const search = options.search.trim();
      if (search.length > 100) throw new BadRequestException('Search is too long');
      const regex = new RegExp(escapeRegexLiteral(search), 'iu');
      filter.$or = [{ content: regex }, { nick: regex }, { mail: regex }, { path: regex }];
    }
    const [total, comments, statusCounts] = await Promise.all([
      this.commentModel.countDocuments(filter).maxTimeMS(2_000).exec(),
      this.commentModel
        .find(filter)
        .select('+mail +ip +ua')
        .sort({ createdAt: -1, _id: -1 })
        .skip((options.page - 1) * options.pageSize)
        .limit(options.pageSize)
        .lean()
        .maxTimeMS(2_000)
        .exec(),
      this.commentModel
        .aggregate<{ _id: CommentStatus; count: number }>([
          { $group: { _id: '$status', count: { $sum: 1 } } },
        ])
        .option({ maxTimeMS: 2_000 })
        .exec(),
    ]);
    const counts: Record<CommentStatus, number> = {
      approved: 0,
      pending: 0,
      spam: 0,
      deleted: 0,
    };
    for (const item of statusCounts) counts[item._id] = item.count;
    return {
      items: comments.map((comment) => this.toAdmin(comment)),
      total,
      page: options.page,
      pageSize: options.pageSize,
      counts,
    };
  }

  async updateStatus(idValue: unknown, status: ModeratableCommentStatus) {
    const id = normalizeCommentId(idValue, true);
    const existing = await this.commentModel.findById(id).lean().exec();
    if (!existing) throw new NotFoundException('Comment not found');
    if (existing.status === 'deleted') {
      throw new BadRequestException('A deleted comment cannot be restored');
    }
    if (status === 'approved' && existing.parentId) {
      const parent = await this.commentModel
        .exists({ _id: existing.parentId, status: 'approved' })
        .exec();
      if (!parent) throw new BadRequestException('Approve the parent comment first');
    }

    // Change the selected node first and make the write conditional on it not
    // having been deleted in the meantime. This closes both the
    // moderation/reply race and a soft-delete/status race that could otherwise
    // restore a scrubbed placeholder to an approved state.
    const updated = await this.commentModel
      .findOneAndUpdate(
        { _id: id, status: { $ne: 'deleted' } },
        { $set: { status } },
        { new: true },
      )
      .select('+mail +ip +ua')
      .lean()
      .exec();
    if (!updated) throw new BadRequestException('A deleted comment cannot be restored');

    if (status !== 'approved') {
      const descendantIds = await this.collectDescendantIds(existing._id);
      if (descendantIds.length > 0) {
        await this.commentModel
          .updateMany(
            { _id: { $in: descendantIds }, status: { $ne: 'deleted' } },
            { $set: { status } },
          )
          .exec();
      }
    }
    return this.toAdmin(updated);
  }

  async softDelete(idValue: unknown) {
    const id = normalizeCommentId(idValue, true);
    const existing = await this.commentModel.findById(id).select('+mail +legacyId').lean().exec();
    if (!existing) throw new NotFoundException('Comment not found');
    const updated = await this.commentModel
      .findByIdAndUpdate(
        id,
        {
          $set: {
            status: 'deleted',
            content: '[deleted]',
            nick: 'Anonymous',
            mail: '',
            link: '',
            likes: 0,
            isAdmin: false,
            ip: '',
            ua: '',
            location: '',
            browser: '',
            os: '',
          },
          $unset: { duplicateKeys: 1 },
        },
        { new: true },
      )
      .select('+mail')
      .lean()
      .exec();
    if (!updated) throw new NotFoundException('Comment not found');
    await this.reactionModel?.deleteMany({ commentId: existing._id }).exec();
    return this.toAdmin(updated);
  }

  private async collectDescendantIds(rootId: Types.ObjectId): Promise<Types.ObjectId[]> {
    const collected: Types.ObjectId[] = [];
    let frontier = [rootId];
    const visited = new Set([String(rootId)]);
    for (let depth = 0; frontier.length > 0 && depth < 64; depth += 1) {
      const children = await this.commentModel
        .find({ parentId: { $in: frontier } }, { _id: 1 })
        .lean()
        .maxTimeMS(2_000)
        .exec();
      frontier = [];
      for (const child of children) {
        const key = String(child._id);
        if (visited.has(key)) continue;
        visited.add(key);
        collected.push(child._id);
        frontier.push(child._id);
        if (collected.length > MAX_MODERATION_DESCENDANTS) {
          throw new BadRequestException('The comment thread is too large to moderate safely');
        }
      }
    }
    if (frontier.length > 0) throw new BadRequestException('The comment reply chain is too deep');
    return collected;
  }

  async replyAsAdmin(
    idValue: unknown,
    contentValue: unknown,
    nickname?: string,
    metadata?: CommentRequestMetadata,
  ) {
    const id = normalizeCommentId(idValue, true);
    const content = normalizeCommentContent(contentValue);
    const setting = await this.settingProvider.getCommentSetting();
    if (content.length > setting.maxLength) {
      throw new BadRequestException(`Comment content exceeds ${setting.maxLength} characters`);
    }
    const parent = await this.commentModel.findOne({ _id: id, status: 'approved' }).lean().exec();
    if (!parent) throw new BadRequestException('Reply target must be an approved comment');
    await this.replyDepth(parent);
    const rootId = parent.rootId || parent._id;
    const replyCount = await this.ensureThreadPositions(rootId);
    if (replyCount >= MAX_REPLIES_PER_ROOT) {
      throw new BadRequestException(`A thread may contain at most ${MAX_REPLIES_PER_ROOT} replies`);
    }
    const clientInfo = await this.clientInfo(metadata);
    const created = await this.createCommentDocument(
      {
        path: parent.path,
        ...(parent.articleId === undefined ? {} : { articleId: parent.articleId }),
        content,
        nick:
          String(nickname || '管理员')
            .trim()
            .slice(0, 80) || '管理员',
        mail: 'admin@localhost.invalid',
        link: '',
        parentId: parent._id,
        rootId,
        status: 'approved',
        isAdmin: true,
        ...clientInfo,
      },
      rootId,
    );
    await this.retainReplyOnlyWhileParentApproved(created, parent._id);
    return this.toAdmin(created.toObject());
  }

  async exportForBackup() {
    const comments = await this.commentModel
      .find({})
      .select('+mail +legacyId +ip +ua')
      .sort({ createdAt: 1, _id: 1 })
      .lean()
      .exec();
    return comments.map((comment) => {
      const item = this.toAdmin(comment);
      const deleted = comment.status === 'deleted';
      return {
        ...item,
        ...(comment.legacyId ? { legacyId: String(comment.legacyId) } : {}),
        ...(deleted
          ? {
              content: '[deleted]',
              nick: 'Anonymous',
              mail: '',
              link: '',
              likes: 0,
              isAdmin: false,
              ip: '',
              ua: '',
              location: '',
              browser: '',
              os: '',
            }
          : {}),
      };
    });
  }

  async exportMigrationTombstonesForBackup() {
    const tombstones = await this.tombstoneModel
      .find({}, { legacyId: 1, _id: 0 })
      .sort({ legacyId: 1 })
      .lean()
      .exec();
    return tombstones.map((item) => String(item.legacyId));
  }

  private prepareMigrationTombstones(value: unknown) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.length > 100_000) {
      throw new BadRequestException('Invalid comment migration tombstones backup');
    }
    const legacyIds = new Set<string>();
    for (const item of value) {
      const raw = typeof item === 'string' ? item : (item as any)?.legacyId;
      if (typeof raw !== 'string') {
        throw new BadRequestException('Invalid comment migration tombstone');
      }
      const legacyId = raw.trim();
      if (!legacyId || legacyId.length > 512 || /[\u0000-\u001f\u007f]/u.test(legacyId)) {
        throw new BadRequestException('Invalid comment migration tombstone');
      }
      if (legacyIds.has(legacyId)) {
        throw new BadRequestException('Duplicate comment migration tombstone');
      }
      legacyIds.add(legacyId);
    }
    return [...legacyIds];
  }

  validateMigrationTombstonesBackup(value: unknown) {
    return { valid: this.prepareMigrationTombstones(value).length };
  }

  async importMigrationTombstonesFromBackup(value: unknown) {
    const legacyIds = this.prepareMigrationTombstones(value);
    if (legacyIds.length > 0) {
      await this.tombstoneModel.bulkWrite(
        legacyIds.map((legacyId) => ({
          updateOne: {
            filter: { legacyId },
            update: { $setOnInsert: { legacyId } },
            upsert: true,
          },
        })),
        { ordered: true },
      );
    }
    return { imported: legacyIds.length };
  }

  private prepareBackupImport(value: unknown) {
    if (value === undefined || value === null) {
      return { operations: [], errors: [], invalid: 0, identities: [], articleIds: [] };
    }
    if (!Array.isArray(value) || value.length > 100_000) {
      throw new BadRequestException('Invalid comments backup');
    }
    const operations: any[] = [];
    const identities: Array<{ id: string; legacyId?: string }> = [];
    const articleIds = new Set<number>();
    const errors: Array<{ index: number; id?: string; reason: string }> = [];
    let invalid = 0;
    const addError = (error: { index: number; id?: string; reason: string }) => {
      invalid += 1;
      if (errors.length < 100) errors.push(error);
    };
    const ids = new Set<string>();
    const legacyIds = new Set<string>();
    const graph = new Map<
      string,
      {
        index: number;
        id: string;
        path: string;
        articleId?: number;
        parentId?: string;
        rootId?: string;
        status: CommentStatus;
      }
    >();
    for (let index = 0; index < value.length; index += 1) {
      const item = value[index];
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        addError({ index, reason: 'Comment must be an object' });
        continue;
      }
      const raw = item as Record<string, unknown>;
      try {
        const id = normalizeCommentId(raw.id ?? raw._id, true);
        if (ids.has(id)) throw new Error('Duplicate comment id');
        ids.add(id);
        const status = String(raw.status || 'pending');
        if (!['approved', 'pending', 'spam', 'deleted'].includes(status)) {
          throw new Error('Invalid status');
        }
        const deleted = status === 'deleted';
        const input = normalizeCreateComment(
          {
            path: raw.path ?? raw.url,
            content: deleted ? '[deleted]' : raw.content ?? raw.comment,
            nick: deleted ? 'Anonymous' : raw.nick,
            mail: deleted ? '' : raw.mail,
            link: deleted ? '' : raw.link,
          },
          COMMENT_STORED_CONTENT_MAX_LENGTH,
        );
        const parentId = normalizeCommentId(raw.replyToId, false);
        const rootId = normalizeCommentId(raw.parentId, false);
        const createdAt = new Date(String(raw.createdAt || ''));
        const updatedAt = new Date(String(raw.updatedAt || raw.createdAt || ''));
        if (Number.isNaN(createdAt.getTime()) || Number.isNaN(updatedAt.getTime())) {
          throw new Error('Invalid date');
        }
        const clientMetadata = deleted
          ? { ip: '', ua: '', location: '', browser: '', os: '' }
          : {
              ip: backupMetadataString(raw.ip, 128, 'unknown'),
              ua: backupMetadataString(raw.ua, 512, ''),
              location: backupMetadataString(raw.location, 160, '未知地区'),
              browser: backupMetadataString(raw.browser, 128, '未知浏览器'),
              os: backupMetadataString(raw.os, 128, '未知系统'),
            };
        let articleId: number | undefined;
        if (raw.articleId !== undefined && raw.articleId !== null && raw.articleId !== '') {
          articleId = Number(raw.articleId);
          if (!Number.isSafeInteger(articleId) || articleId < 0) {
            throw new Error('Invalid articleId');
          }
        }
        // Backups predating stable article ids cannot prove that a /post path
        // still belongs to the same article. Keep those records quarantined
        // rather than exposing them when a slug has since been reused.
        const quarantined =
          raw.quarantined === true || (articleId === undefined && input.path.startsWith('/post/'));
        let legacyId: string | undefined;
        if (raw.legacyId !== undefined && raw.legacyId !== null && raw.legacyId !== '') {
          legacyId = String(raw.legacyId).trim();
          if (!legacyId || legacyId.length > 512 || /[\u0000-\u001f\u007f]/u.test(legacyId)) {
            throw new Error('Invalid legacyId');
          }
          if (legacyIds.has(legacyId)) throw new Error('Duplicate legacyId');
          legacyIds.add(legacyId);
        }
        graph.set(id, {
          index,
          id,
          path: input.path,
          ...(articleId === undefined ? {} : { articleId }),
          ...(parentId ? { parentId } : {}),
          ...(rootId ? { rootId } : {}),
          status: status as CommentStatus,
        });
        identities.push({ id, ...(legacyId === undefined ? {} : { legacyId }) });
        if (articleId !== undefined) articleIds.add(articleId);
        const unset: Record<string, 1> = {
          duplicateKeys: 1,
          threadPosition: 1,
          ...(articleId === undefined ? { articleId: 1 } : {}),
          ...(!quarantined ? { quarantined: 1 } : {}),
          ...(legacyId === undefined ? { legacyId: 1 } : {}),
        };
        operations.push({
          updateOne: {
            filter: { _id: new Types.ObjectId(id) },
            update: {
              $set: {
                ...input,
                ...(articleId === undefined ? {} : { articleId }),
                ...(quarantined ? { quarantined: true } : {}),
                ...(legacyId === undefined ? {} : { legacyId }),
                parentId: parentId ? new Types.ObjectId(parentId) : null,
                rootId: rootId ? new Types.ObjectId(rootId) : null,
                status,
                likes: deleted ? 0 : Math.max(0, Math.floor(Number(raw.likes) || 0)),
                isAdmin: deleted ? false : Boolean(raw.isAdmin),
                ...clientMetadata,
                createdAt,
                updatedAt,
              },
              $unset: unset,
            },
            upsert: true,
            // Preserve backup time values. For an upsert Mongoose keeps
            // createdAt in $setOnInsert (fresh restores retain it; existing
            // records keep their original creation time) and leaves the
            // supplied updatedAt untouched.
            timestamps: false,
          },
        });
      } catch (error: any) {
        addError({
          index,
          ...(typeof raw.id === 'string' ? { id: raw.id } : {}),
          reason: String(error?.message || 'Invalid comment'),
        });
      }
    }

    const sameTarget = (
      first: { path: string; articleId?: number },
      second: { path: string; articleId?: number },
    ) => {
      if (first.articleId !== undefined && second.articleId !== undefined) {
        return first.articleId === second.articleId;
      }
      return first.path === second.path;
    };
    for (const record of graph.values()) {
      if (!record.parentId) {
        if (record.rootId) {
          addError({
            index: record.index,
            id: record.id,
            reason: 'A root comment cannot have rootId',
          });
        }
        continue;
      }
      const directParent = graph.get(record.parentId);
      if (!directParent) {
        addError({ index: record.index, id: record.id, reason: 'Reply parent is missing' });
        continue;
      }
      if (!sameTarget(record, directParent)) {
        addError({ index: record.index, id: record.id, reason: 'Reply crosses comment targets' });
        continue;
      }
      if (record.status === 'approved' && !['approved', 'deleted'].includes(directParent.status)) {
        addError({
          index: record.index,
          id: record.id,
          reason: 'An approved reply requires an approved or deleted parent',
        });
        continue;
      }

      const visited = new Set([record.id]);
      let cursor = record;
      let depth = 0;
      let invalidChain = false;
      while (cursor.parentId) {
        depth += 1;
        if (depth > MAX_REPLY_DEPTH) {
          addError({ index: record.index, id: record.id, reason: 'Reply chain is too deep' });
          invalidChain = true;
          break;
        }
        if (visited.has(cursor.parentId)) {
          addError({ index: record.index, id: record.id, reason: 'Reply chain contains a cycle' });
          invalidChain = true;
          break;
        }
        visited.add(cursor.parentId);
        const parent = graph.get(cursor.parentId);
        if (!parent) {
          addError({ index: record.index, id: record.id, reason: 'Reply ancestor is missing' });
          invalidChain = true;
          break;
        }
        if (!sameTarget(record, parent)) {
          addError({
            index: record.index,
            id: record.id,
            reason: 'Reply ancestor crosses targets',
          });
          invalidChain = true;
          break;
        }
        if (record.status === 'approved' && !['approved', 'deleted'].includes(parent.status)) {
          addError({
            index: record.index,
            id: record.id,
            reason: 'An approved reply has a hidden ancestor',
          });
          invalidChain = true;
          break;
        }
        cursor = parent;
      }
      if (invalidChain) continue;
      if (!record.rootId || cursor.id !== record.rootId) {
        addError({ index: record.index, id: record.id, reason: 'Reply rootId is inconsistent' });
      }
    }

    // Restores are fail-closed rather than silently truncating a backup. This
    // keeps the same per-thread invariant as live creation and Waline import.
    const repliesPerRoot = new Map<string, number>();
    const oversizedRoots = new Set<string>();
    for (const record of graph.values()) {
      if (!record.parentId || !record.rootId) continue;
      const count = (repliesPerRoot.get(record.rootId) || 0) + 1;
      repliesPerRoot.set(record.rootId, count);
      if (count > MAX_REPLIES_PER_ROOT && !oversizedRoots.has(record.rootId)) {
        oversizedRoots.add(record.rootId);
        addError({
          index: record.index,
          id: record.id,
          reason: `A thread may contain at most ${MAX_REPLIES_PER_ROOT} replies`,
        });
      }
    }
    return { operations, errors, invalid, identities, articleIds: [...articleIds] };
  }

  validateBackup(value: unknown) {
    const prepared = this.prepareBackupImport(value);
    if (prepared.invalid > 0) {
      throw new BadRequestException({
        message: 'Invalid comments backup; nothing was imported',
        invalid: prepared.invalid,
        errors: prepared.errors,
      });
    }
    return { valid: prepared.operations.length };
  }

  reconcileBackupArticleTargets(value: unknown, articles: unknown) {
    const prepared = this.prepareBackupImport(value);
    if (prepared.invalid > 0) {
      throw new BadRequestException({
        message: 'Invalid comments backup; nothing was imported',
        invalid: prepared.invalid,
        errors: prepared.errors,
      });
    }
    if (!Array.isArray(articles)) throw new BadRequestException('Backup articles must be an array');
    const backupArticleIds = new Set(
      articles
        .map((article: any) => Number(article?.id))
        .filter((id) => Number.isSafeInteger(id) && id > 0),
    );
    const missing = new Set(prepared.articleIds.filter((id) => !backupArticleIds.has(id)));
    if (missing.size === 0) return { comments: value, quarantined: 0 };
    if (!Array.isArray(value)) throw new BadRequestException('Invalid comments backup');
    let quarantined = 0;
    const comments = value.map((raw: any) => {
      const articleId = Number(raw?.articleId);
      if (!Number.isSafeInteger(articleId) || !missing.has(articleId)) return raw;
      quarantined += 1;
      return { ...raw, quarantined: true };
    });
    // Deleted articles are intentionally absent from normal site backups.
    // Their comments stay available to the administrator but must not bind to
    // an unrelated same-id article in a non-empty restore target.
    return { comments, quarantined };
  }

  reconcileBackupWithMigrationTombstones(comments: unknown, tombstones: unknown) {
    const tombstonedLegacyIds = new Set(this.prepareMigrationTombstones(tombstones));
    if (tombstonedLegacyIds.size === 0) return { comments, suppressed: 0 };
    if (!Array.isArray(comments)) throw new BadRequestException('Invalid comments backup');

    const suppressedIds = new Set<string>();
    const suppressedIndexes = new Set<number>();
    for (let index = 0; index < comments.length; index += 1) {
      const raw = comments[index] as any;
      const legacyId = typeof raw?.legacyId === 'string' ? raw.legacyId.trim() : '';
      if (!legacyId || !tombstonedLegacyIds.has(legacyId)) continue;
      if (raw?.status !== 'deleted') {
        throw new BadRequestException(
          'A permanently deleted migration tombstone conflicts with live comment content',
        );
      }
      const id = normalizeCommentId(raw.id ?? raw._id, true) as string;
      suppressedIds.add(id);
      suppressedIndexes.add(index);
    }

    if (suppressedIds.size > 0) {
      for (let index = 0; index < comments.length; index += 1) {
        if (suppressedIndexes.has(index)) continue;
        const raw = comments[index] as any;
        const directParent = normalizeCommentId(raw?.replyToId, false);
        const root = normalizeCommentId(raw?.parentId, false);
        if (
          (directParent && suppressedIds.has(directParent)) ||
          (root && suppressedIds.has(root))
        ) {
          throw new BadRequestException(
            'A permanent migration tombstone conflicts with a comment that still has descendants',
          );
        }
      }
    }
    return {
      comments: comments.filter((_, index) => !suppressedIndexes.has(index)),
      suppressed: suppressedIndexes.size,
    };
  }

  async preflightBackup(value: unknown) {
    const prepared = this.prepareBackupImport(value);
    if (prepared.invalid > 0) {
      throw new BadRequestException({
        message: 'Invalid comments backup; nothing was imported',
        invalid: prepared.invalid,
        errors: prepared.errors,
      });
    }

    // Comment restore is an exact/empty-target operation, not an implicit
    // merge. Extra target rows could leave stale reply edges or make the
    // restored union exceed the per-thread cap even though the backup itself
    // is valid.
    const backupObjectIds = prepared.identities.map((item) => new Types.ObjectId(item.id));
    const existingTotal = await this.commentModel.countDocuments({}).maxTimeMS(2_000).exec();
    const matchingExisting =
      existingTotal > 0 && backupObjectIds.length > 0
        ? await this.commentModel
            .countDocuments({ _id: { $in: backupObjectIds } })
            .maxTimeMS(2_000)
            .exec()
        : 0;
    if (existingTotal !== matchingExisting) {
      throw new BadRequestException({
        message:
          'Comments backup requires an empty comment collection or the exact same comment identities; nothing was imported',
        existing: existingTotal,
        matching: matchingExisting,
      });
    }

    const expectedIds = new Map(
      prepared.identities
        .filter((item) => Boolean(item.legacyId))
        .map((item) => [String(item.legacyId), item.id]),
    );
    const legacyIds = [...expectedIds.keys()];
    const conflicts: Array<{ legacyId: string; existingId: string; backupId: string }> = [];
    const deletionConflicts: string[] = [];
    for (let offset = 0; offset < legacyIds.length; offset += 1_000) {
      const chunk = legacyIds.slice(offset, offset + 1_000);
      const rows: any[] = await this.commentModel
        .find({ legacyId: { $in: chunk } }, { _id: 1, legacyId: 1 })
        .select('+legacyId')
        .lean()
        .maxTimeMS(2_000)
        .exec();
      for (const row of rows) {
        const legacyId = String(row.legacyId || '');
        const backupId = expectedIds.get(legacyId);
        if (backupId && String(row._id) !== backupId && conflicts.length < 100) {
          conflicts.push({ legacyId, existingId: String(row._id), backupId });
        }
      }
      const tombstones = await this.tombstoneModel
        .find({ legacyId: { $in: chunk } }, { legacyId: 1, _id: 0 })
        .lean()
        .maxTimeMS(2_000)
        .exec();
      for (const tombstone of tombstones) {
        if (deletionConflicts.length < 100) deletionConflicts.push(String(tombstone.legacyId));
      }
    }
    if (conflicts.length > 0) {
      throw new BadRequestException({
        message: 'Comments backup conflicts with existing legacy identities; nothing was imported',
        conflicts,
      });
    }
    if (deletionConflicts.length > 0) {
      throw new BadRequestException({
        message:
          'Comments backup would restore permanently deleted migration data; nothing was imported',
        legacyIds: deletionConflicts,
      });
    }
    return { valid: prepared.operations.length };
  }

  async importFromBackup(value: unknown) {
    await this.preflightBackup(value);
    const { operations, errors, invalid } = this.prepareBackupImport(value);
    if (invalid > 0) {
      throw new BadRequestException({
        message: 'Invalid comments backup; nothing was imported',
        invalid,
        errors,
      });
    }
    if (operations.length > 0) {
      await this.commentModel.bulkWrite(operations, { ordered: true });
    }
    return { imported: operations.length, skipped: 0, errors: [] };
  }

  /**
   * Idempotently copies the old ThinkJS Mongo `Comment` collection into the
   * native collection. It is intentionally admin-triggered rather than a
   * startup migration so upgrades never rewrite comment data silently.
   */
  async migrateWaline() {
    const sourceDb = this.connection.getClient().db(config.legacyWalineDB);
    const sourceCollections = await sourceDb.listCollections({}, { nameOnly: true }).toArray();
    const commentCollectionName = sourceCollections.find(
      (item) => item.name.toLocaleLowerCase() === 'comment',
    )?.name;
    if (!commentCollectionName) {
      return {
        sourceDatabase: config.legacyWalineDB,
        sourceCollection: 'Comment',
        scanned: 0,
        imported: 0,
        created: 0,
        existing: 0,
        skipped: 0,
        errorCount: 0,
        errors: [],
        skippedDetails: [],
      };
    }

    // A legacy import is deterministic only before visitors start creating
    // native rows. Mixing pre-existing native replies with the legacy graph
    // could make their union exceed the atomic 100-slot thread capacity. A
    // partial rerun remains allowed because every imported row has legacyId.
    const nativeComment = await this.commentModel.exists({ legacyId: { $exists: false } }).exec();
    if (nativeComment) {
      throw new BadRequestException(
        'Import Waline before accepting native comments; the native comment collection is not empty',
      );
    }

    const adminIds = new Set<string>();
    const userCollectionName = sourceCollections.find((item) => /^users?$/iu.test(item.name))?.name;
    if (userCollectionName) {
      const users = await sourceDb
        .collection(userCollectionName)
        .find(
          {},
          {
            projection: {
              _id: 1,
              id: 1,
              objectId: 1,
              type: 1,
              role: 1,
              isAdmin: 1,
            },
          },
        )
        .limit(100_000)
        .toArray();
      for (const user of users) {
        const role = String(user.type || user.role || '').toLocaleLowerCase();
        if (!['administrator', 'admin'].includes(role) && user.isAdmin !== true) continue;
        for (const value of [user._id, user.id, user.objectId]) {
          if (value !== undefined && value !== null && String(value)) adminIds.add(String(value));
        }
      }
    }

    const statusMap: Record<string, CommentStatus> = {
      approved: 'approved',
      waiting: 'pending',
      pending: 'pending',
      spam: 'spam',
      deleted: 'deleted',
    };
    const asObjectId = (value: unknown): Types.ObjectId | null => {
      if (value instanceof Types.ObjectId) return value;
      const normalized = value === undefined || value === null ? '' : String(value);
      return Types.ObjectId.isValid(normalized) ? new Types.ObjectId(normalized) : null;
    };
    const asLegacyReference = (value: unknown): string | undefined => {
      if (value === undefined || value === null || value === '') return undefined;
      const normalized = String(value);
      return normalized || undefined;
    };
    type LegacyGraphNode = {
      id: string;
      path: string;
      sourceId: Types.ObjectId | null;
      status: CommentStatus;
      pid?: string;
      rid?: string;
      invalidReason?: string;
    };
    const legacyGraph = new Map<string, LegacyGraphNode>();
    let scanned = 0;
    // Build a small relationship graph first. Old Waline rows can omit `rid`
    // for replies-to-replies, and Mongo's natural order is not guaranteed to
    // put their parents first. Resolving the chain before writes prevents
    // dangling replies that count in MongoDB but can never render publicly.
    const graphCursor = sourceDb.collection(commentCollectionName).find(
      {},
      {
        projection: { _id: 1, url: 1, pid: 1, rid: 1, comment: 1, status: 1 },
        batchSize: 250,
      },
    );
    for await (const legacy of graphCursor) {
      scanned += 1;
      if (scanned > MAX_MIGRATION_COMMENTS) {
        throw new BadRequestException(
          `Waline migration is limited to ${MAX_MIGRATION_COMMENTS} comments; use an offline database migration for a larger source`,
        );
      }
      const id = String(legacy._id || '');
      let path = '';
      let invalidReason: string | undefined;
      if (!id || id.length > 512 || /[\u0000-\u001f\u007f]/u.test(id)) {
        invalidReason = 'Invalid legacy id';
      }
      try {
        path = normalizeCommentPath(legacy.url);
      } catch {
        invalidReason ||= 'Invalid comment path';
      }
      try {
        const deleted = statusMap[String(legacy.status || 'approved')] === 'deleted';
        normalizeCommentContent(
          deleted ? '[deleted]' : String(legacy.comment || '') || '(empty comment)',
          COMMENT_STORED_CONTENT_MAX_LENGTH,
        );
      } catch (error) {
        invalidReason ||= String((error as any)?.message || 'Invalid comment content');
      }
      const node: LegacyGraphNode = {
        id,
        path,
        sourceId: asObjectId(legacy._id),
        status: statusMap[String(legacy.status || 'approved')] || 'pending',
        ...(asLegacyReference(legacy.pid) ? { pid: asLegacyReference(legacy.pid) } : {}),
        ...(asLegacyReference(legacy.rid) ? { rid: asLegacyReference(legacy.rid) } : {}),
        ...(invalidReason ? { invalidReason } : {}),
      };
      const duplicate = legacyGraph.get(id);
      if (duplicate) {
        duplicate.invalidReason = 'Duplicate legacy id representation';
        node.invalidReason = 'Duplicate legacy id representation';
      }
      legacyGraph.set(id, node);
    }

    const tombstonedLegacyIds = new Set<string>();
    const resolveLegacyReply = (node: LegacyGraphNode) => {
      if (node.invalidReason) throw new Error(node.invalidReason);
      if (tombstonedLegacyIds.has(node.id)) {
        throw new Error('Comment was permanently deleted after migration');
      }
      if (!node.pid) {
        if (node.rid && node.rid !== node.id) {
          throw new Error('A root comment has an inconsistent rid');
        }
        return { parentId: null, rootId: null, depth: 0 };
      }

      const chain: LegacyGraphNode[] = [node];
      const visited = new Set([node.id]);
      let current = node;
      let depth = 0;
      while (current.pid) {
        depth += 1;
        if (depth > MAX_REPLY_DEPTH) throw new Error('Legacy reply chain is too deep');
        if (visited.has(current.pid)) throw new Error('Legacy reply chain contains a cycle');
        visited.add(current.pid);
        const parent = legacyGraph.get(current.pid);
        if (!parent) throw new Error('Legacy reply parent is missing');
        if (parent.invalidReason)
          throw new Error(`Legacy reply parent is invalid: ${parent.invalidReason}`);
        if (parent.path !== node.path) throw new Error('Legacy reply crosses comment targets');
        if (tombstonedLegacyIds.has(parent.id)) {
          throw new Error('Legacy reply has a permanently deleted ancestor');
        }
        chain.push(parent);
        current = parent;
      }

      const directParent = chain[1];
      const root = chain[chain.length - 1];
      if (!directParent?.sourceId || !root.sourceId) {
        throw new Error('Legacy reply references a non-ObjectId comment');
      }
      for (const item of chain) {
        if (item.rid && item.rid !== root.id) {
          throw new Error('Legacy reply rid is inconsistent with its parent chain');
        }
      }
      if (
        node.status === 'approved' &&
        chain.slice(1).some((ancestor) => !['approved', 'deleted'].includes(ancestor.status))
      ) {
        throw new Error('Legacy approved reply has a hidden ancestor');
      }
      return { parentId: directParent.sourceId, rootId: root.sourceId, depth };
    };

    const graphLegacyIds = [...legacyGraph.keys()].filter(Boolean);
    for (let offset = 0; offset < graphLegacyIds.length; offset += 1_000) {
      const tombstones = await this.tombstoneModel
        .find(
          { legacyId: { $in: graphLegacyIds.slice(offset, offset + 1_000) } },
          { legacyId: 1, _id: 0 },
        )
        .lean()
        .maxTimeMS(2_000)
        .exec();
      for (const tombstone of tombstones) tombstonedLegacyIds.add(String(tombstone.legacyId));
    }

    // Pick a stable, idempotent subset when a legacy thread exceeds the
    // native capacity. Sort by depth before id so the chosen subset is always
    // ancestor-closed even when imported/client-generated ObjectIds are not in
    // creation order. Rerunning a migration therefore cannot select a
    // different extra set or create an orphan at the capacity boundary.
    const allowedLegacyReplies = new Set<string>();
    const repliesPerRoot = new Map<string, number>();
    const replyCandidates: Array<{
      id: string;
      rootKey: string;
      depth: number;
    }> = [];
    for (const node of legacyGraph.values()) {
      try {
        const { rootId, depth } = resolveLegacyReply(node);
        if (!rootId) continue;
        replyCandidates.push({ id: node.id, rootKey: String(rootId), depth });
      } catch {
        // The main migration pass records the precise validation reason once.
      }
    }
    replyCandidates.sort((first, second) => {
      if (first.rootKey !== second.rootKey) return first.rootKey < second.rootKey ? -1 : 1;
      if (first.depth !== second.depth) return first.depth - second.depth;
      if (first.id === second.id) return 0;
      return first.id < second.id ? -1 : 1;
    });
    for (const candidate of replyCandidates) {
      const count = repliesPerRoot.get(candidate.rootKey) || 0;
      if (count >= MAX_REPLIES_PER_ROOT) continue;
      repliesPerRoot.set(candidate.rootKey, count + 1);
      allowedLegacyReplies.add(candidate.id);
    }

    let imported = 0;
    let existing = 0;
    let skipped = 0;
    let errorCount = 0;
    const errors: Array<{ legacyId: string; reason: string }> = [];
    const skippedDetails: Array<{ legacyId: string; reason: string }> = [];
    const recordSkipped = (legacyId: string, reason: string) => {
      skipped += 1;
      if (skippedDetails.length < 100) skippedDetails.push({ legacyId, reason });
    };
    const recordError = (legacyId: string, error: unknown) => {
      errorCount += 1;
      if (errors.length < 100) {
        errors.push({
          legacyId,
          reason: String((error as any)?.message || error || 'Unknown migration error'),
        });
      }
    };
    const targetCache = new Map<string, ResolvedCommentTarget | null>();
    const cursor = sourceDb.collection(commentCollectionName).find({}, { batchSize: 250 });
    for await (const legacy of cursor) {
      const legacyId = String(legacy._id || '');
      let path: string;
      try {
        path = normalizeCommentPath(legacy.url);
      } catch {
        recordSkipped(legacyId, 'Invalid comment path');
        continue;
      }
      if (!legacyId || legacyId.length > 512 || /[\u0000-\u001f\u007f]/u.test(legacyId)) {
        recordSkipped(legacyId, 'Invalid legacy id');
        continue;
      }
      if (tombstonedLegacyIds.has(legacyId)) {
        recordSkipped(legacyId, 'Comment was permanently deleted after migration');
        continue;
      }
      const graphNode = legacyGraph.get(legacyId);
      if (!graphNode) {
        recordSkipped(legacyId, 'Legacy relationship metadata is missing');
        continue;
      }
      let parentId: Types.ObjectId | null;
      let rootId: Types.ObjectId | null;
      try {
        ({ parentId, rootId } = resolveLegacyReply(graphNode));
      } catch (error) {
        recordSkipped(legacyId, String((error as any)?.message || 'Invalid legacy reply chain'));
        continue;
      }
      if (rootId && !allowedLegacyReplies.has(legacyId)) {
        recordSkipped(legacyId, `Legacy thread exceeds the ${MAX_REPLIES_PER_ROOT}-reply limit`);
        continue;
      }
      const sourceId = graphNode.sourceId;
      let target = targetCache.get(path);
      if (!targetCache.has(path)) {
        target = await this.resolveStoredTarget(path);
        targetCache.set(path, target);
      }
      let link = '';
      try {
        link = normalizeCommentLink(legacy.link);
      } catch {
        // Old Waline accepted arbitrary profile links. Do not carry unsafe
        // protocols such as javascript: into the native public API.
      }
      const legacyCreatedAt = new Date(legacy.insertedAt || legacy.createdAt || Date.now());
      const legacyUpdatedAt = new Date(legacy.updatedAt || legacy.insertedAt || Date.now());
      const createdAt = Number.isNaN(legacyCreatedAt.getTime()) ? new Date() : legacyCreatedAt;
      const updatedAt = Number.isNaN(legacyUpdatedAt.getTime()) ? createdAt : legacyUpdatedAt;
      const status = statusMap[String(legacy.status || 'approved')] || 'pending';
      const deleted = status === 'deleted';
      let content: string;
      try {
        content = normalizeCommentContent(
          deleted ? '[deleted]' : String(legacy.comment || '') || '(empty comment)',
          COMMENT_STORED_CONTENT_MAX_LENGTH,
        );
      } catch (error) {
        recordSkipped(legacyId, String((error as any)?.message || 'Invalid comment content'));
        continue;
      }
      const nick = deleted
        ? 'Anonymous'
        : String(legacy.nick || 'Anonymous')
            .replace(/[\r\n\t\u2028\u2029]/gu, ' ')
            .trim()
            .slice(0, 80) || 'Anonymous';
      let mail = '';
      if (!deleted) {
        try {
          mail = normalizeCommentEmail(legacy.mail);
        } catch {
          // Old Waline installations did not always validate email. Keeping
          // an invalid address has no user-visible benefit and would make a
          // future backup restore lossy, so discard only that private field.
        }
      }
      const legacyUserId = String(legacy.user_id || legacy.userId || '');
      // Waline derives `type` while formatting a response; normal Comment
      // rows do not persist it. Only the trusted Users relation may restore a
      // station-owner badge from legacy data.
      const isAdmin = !deleted && adminIds.has(legacyUserId);
      const legacyClientInfo = deleted
        ? { ip: '', ua: '', location: '', browser: '', os: '' }
        : await this.clientInfo({
            ip: legacy.ip,
            ua: legacy.ua || legacy.userAgent,
          });
      try {
        const update = await this.commentModel
          .updateOne(
            { legacyId },
            {
              $setOnInsert: {
                ...(sourceId ? { _id: sourceId } : {}),
                legacyId,
                path,
                ...(target?.articleId === undefined ? {} : { articleId: target.articleId }),
                ...(!target && path.startsWith('/post/') ? { quarantined: true } : {}),
                content,
                nick,
                mail,
                link: deleted ? '' : link,
                parentId,
                rootId,
                status,
                likes: deleted ? 0 : Math.max(0, Number(legacy.like) || 0),
                isAdmin,
                ...legacyClientInfo,
                createdAt,
                updatedAt,
              },
            },
            // Both legacy timestamps live in $setOnInsert. Automatic Mongoose
            // timestamps would also inject $set.updatedAt, which conflicts at
            // the MongoDB update-path level and can make every migration fail.
            { upsert: true, timestamps: false },
          )
          .exec();
        if (update.upsertedCount > 0) imported += 1;
        else existing += 1;
      } catch (error: any) {
        // Backups created before legacyId was exported can already contain the
        // exact Waline ObjectId. Attach the idempotency marker without
        // overwriting the restored content.
        if (error?.code === 11000 && sourceId) {
          try {
            const sameId: any = await this.commentModel
              .findById(sourceId)
              .select('+legacyId')
              .lean()
              .exec();
            if (sameId && !sameId.legacyId) {
              await this.commentModel
                .updateOne(
                  { _id: sourceId, legacyId: { $exists: false } },
                  {
                    $set: {
                      legacyId,
                      ...(target?.articleId === undefined ? {} : { articleId: target.articleId }),
                      ...(!target && path.startsWith('/post/') ? { quarantined: true } : {}),
                    },
                  },
                )
                .exec();
              existing += 1;
              continue;
            }
          } catch (recoveryError) {
            recordError(legacyId, recoveryError);
            continue;
          }
        }
        recordError(legacyId, error);
      }
    }
    return {
      sourceDatabase: config.legacyWalineDB,
      sourceCollection: commentCollectionName,
      scanned,
      imported,
      created: imported,
      existing,
      skipped,
      errorCount,
      errors,
      skippedDetails,
    };
  }
}
