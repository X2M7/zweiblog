import { CommentStatus, PublicCommentDto } from '../types/comment.dto';

const PUBLIC_COMMENT_CONTENT_MAX_LENGTH = 50_000;

export interface SerializableComment {
  _id: unknown;
  content?: unknown;
  path?: unknown;
  rootId?: unknown;
  parentId?: unknown;
  likes?: unknown;
  createdAt?: Date;
  nick?: unknown;
  link?: unknown;
  isAdmin?: unknown;
  status?: CommentStatus;
  // Private fields can be present on an internal object, but are deliberately
  // absent from the returned DTO.
  mail?: unknown;
  ip?: unknown;
  ua?: unknown;
  location?: unknown;
  browser?: unknown;
  os?: unknown;
}

export function serializePublicComment(comment: SerializableComment): PublicCommentDto {
  const deleted = comment.status === 'deleted';
  const rawContent = String(comment.content || '');
  const contentTruncated = !deleted && rawContent.length > PUBLIC_COMMENT_CONTENT_MAX_LENGTH;
  return {
    id: String(comment._id),
    content: deleted ? '该评论已删除' : rawContent.slice(0, PUBLIC_COMMENT_CONTENT_MAX_LENGTH),
    path: String(comment.path || ''),
    parentId: comment.rootId ? String(comment.rootId) : null,
    replyToId: comment.parentId ? String(comment.parentId) : null,
    replyToNick: null,
    likes: deleted ? 0 : Math.max(0, Number(comment.likes) || 0),
    createdAt: comment.createdAt || new Date(0),
    nick: deleted ? '' : String(comment.nick || ''),
    link: deleted ? '' : String(comment.link || ''),
    isAdmin: !deleted && Boolean(comment.isAdmin),
    location: deleted ? '' : String(comment.location || '未知地区').slice(0, 160),
    browser: deleted ? '' : String(comment.browser || '未知浏览器').slice(0, 128),
    os: deleted ? '' : String(comment.os || '未知系统').slice(0, 128),
    ...(deleted ? { deleted: true } : {}),
    ...(contentTruncated ? { contentTruncated: true } : {}),
    replies: [],
  };
}

export function buildPublicCommentTree(
  roots: SerializableComment[],
  replies: SerializableComment[],
  maxDepth = 8,
): PublicCommentDto[] {
  const publicRoots = roots.map(serializePublicComment);
  const publicReplies = replies.map(serializePublicComment);
  const nodes = new Map([...publicRoots, ...publicReplies].map((comment) => [comment.id, comment]));
  const depthCache = new Map(publicRoots.map((comment) => [comment.id, 0]));

  const getDepth = (comment: PublicCommentDto, visiting = new Set<string>()): number => {
    const cached = depthCache.get(comment.id);
    if (cached !== undefined) return cached;
    if (visiting.has(comment.id)) return Number.POSITIVE_INFINITY;
    visiting.add(comment.id);
    const parent = nodes.get(comment.replyToId || '');
    const depth = parent ? getDepth(parent, visiting) + 1 : Number.POSITIVE_INFINITY;
    visiting.delete(comment.id);
    depthCache.set(comment.id, depth);
    return depth;
  };

  for (const reply of publicReplies) {
    // Never promote a reply to the root merely because its direct parent was
    // hidden by moderation or malformed legacy data.
    const parent = nodes.get(reply.replyToId || '');
    const depth = getDepth(reply);
    if (
      parent &&
      parent.id !== reply.id &&
      Number.isFinite(depth) &&
      depth <= Math.max(1, maxDepth)
    ) {
      reply.replyToNick = parent.nick || null;
      parent.replies.push(reply);
    }
  }

  // A deleted node is retained only when it is required to connect visible
  // descendants. Deleted leaves contain no useful public information.
  const pruneDeletedLeaves = (comment: PublicCommentDto): PublicCommentDto | null => {
    comment.replies = comment.replies
      .map(pruneDeletedLeaves)
      .filter((item): item is PublicCommentDto => Boolean(item));
    return comment.deleted && comment.replies.length === 0 ? null : comment;
  };
  return publicRoots
    .map(pruneDeletedLeaves)
    .filter((item): item is PublicCommentDto => Boolean(item));
}
