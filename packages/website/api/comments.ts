export interface LocalComment {
  id: string;
  nick: string;
  content: string;
  link?: string;
  path: string;
  parentId?: string;
  replyToId?: string;
  replyToNick?: string;
  likes: number;
  createdAt: string;
  isAdmin: boolean;
  location?: string;
  browser?: string;
  os?: string;
  liked?: boolean;
  deleted: boolean;
  contentTruncated?: boolean;
  repliesTruncated: boolean;
  replies: LocalComment[];
}

export interface CommentPage {
  items: LocalComment[];
  total: number;
  page: number;
  pageSize: number;
  maxLength: number;
  truncatedReplies: boolean;
}

export interface CreateCommentInput {
  path: string;
  nick: string;
  mail?: string;
  link?: string;
  content: string;
  parentId?: string;
  replyToId?: string;
}

type ApiEnvelope<T> = {
  statusCode?: number;
  data?: T;
  message?: string | string[];
};

export type LikeCommentResult = {
  liked: boolean;
  likes: number;
};

/**
 * Browsers expose non-ASCII path segments in percent-encoded form while
 * article identifiers and migrated comments are commonly stored decoded.
 * Keep one canonical representation at every public comment API boundary.
 */
export function normalizeCommentPath(path: string): string {
  const value = typeof path === "string" && path ? path : "/";
  try {
    return decodeURI(value);
  } catch {
    // Leave malformed escape sequences untouched so the server can reject
    // them consistently instead of turning them into a different path.
    return value;
  }
}

function apiMessage(body: ApiEnvelope<unknown> | undefined, fallback: string) {
  if (Array.isArray(body?.message)) return body.message.join("；");
  return body?.message || fallback;
}

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  let body: ApiEnvelope<T> | undefined;
  try {
    body = (await response.json()) as ApiEnvelope<T>;
  } catch {
    // A proxy may deliberately omit the body for a failed request.
  }
  if (!response.ok || (body?.statusCode && body.statusCode >= 400)) {
    throw new Error(apiMessage(body, `请求失败（${response.status}）`));
  }
  if (body && Object.prototype.hasOwnProperty.call(body, "data")) return body.data as T;
  return body as T;
}

async function readApiResponse<T>(response: Response, fallback: string): Promise<T> {
  let body: ApiEnvelope<T> | undefined;
  try {
    body = (await response.json()) as ApiEnvelope<T>;
  } catch {
    // A proxy may deliberately omit the body for a failed request.
  }
  if (!response.ok || (body?.statusCode && body.statusCode >= 400)) {
    throw new Error(apiMessage(body, fallback));
  }
  if (body && Object.prototype.hasOwnProperty.call(body, "data")) return body.data as T;
  return body as T;
}

export const MAX_COMMENT_RENDER_DEPTH = 20;

function normalizeComment(raw: any, depth = 0): LocalComment {
  const id = String(raw?.id ?? raw?._id ?? raw?.objectId ?? "");
  const deleted = Boolean(raw?.deleted) || raw?.status === "deleted";
  const rawReplies = Array.isArray(raw?.replies) ? raw.replies : [];
  const repliesTruncated = depth >= MAX_COMMENT_RENDER_DEPTH && rawReplies.length > 0;
  return {
    id,
    nick: String(raw?.nick || (deleted ? "已删除" : "匿名访客")).slice(0, 64),
    content: deleted ? "该评论已删除" : String(raw?.content ?? raw?.comment ?? ""),
    link: !deleted && typeof raw?.link === "string" ? raw.link : undefined,
    path: String(raw?.path ?? raw?.url ?? ""),
    parentId: raw?.parentId || raw?.pid ? String(raw?.parentId ?? raw?.pid) : undefined,
    replyToId: raw?.replyToId || raw?.rid ? String(raw?.replyToId ?? raw?.rid) : undefined,
    replyToNick: typeof raw?.replyToNick === "string" ? raw.replyToNick : undefined,
    likes: deleted ? 0 : Math.max(0, Number(raw?.likes ?? raw?.like ?? 0) || 0),
    createdAt: String(raw?.createdAt ?? raw?.insertedAt ?? new Date().toISOString()),
    isAdmin: !deleted && Boolean(raw?.isAdmin),
    location: !deleted && typeof raw?.location === "string" ? raw.location.slice(0, 128) : undefined,
    browser: !deleted && typeof raw?.browser === "string" ? raw.browser.slice(0, 128) : undefined,
    os: !deleted && typeof raw?.os === "string" ? raw.os.slice(0, 128) : undefined,
    liked: !deleted && typeof raw?.liked === "boolean" ? raw.liked : undefined,
    deleted,
    contentTruncated: !deleted && Boolean(raw?.contentTruncated),
    repliesTruncated,
    replies: repliesTruncated
      ? []
      : rawReplies.map((reply: any) => normalizeComment(reply, depth + 1)),
  };
}

export async function getComments(
  path: string,
  page: number,
  pageSize: number,
  signal?: AbortSignal,
): Promise<CommentPage> {
  const params = new URLSearchParams({
    path: normalizeCommentPath(path),
    page: String(page),
    pageSize: String(pageSize),
  });
  const data = await requestJson<any>(`/api/public/comment?${params}`, { signal });
  const items = Array.isArray(data?.items)
    ? data.items
    : Array.isArray(data?.comments)
      ? data.comments
      : Array.isArray(data?.data)
        ? data.data
        : Array.isArray(data)
          ? data
          : [];
  return {
    items: items.map(normalizeComment),
    total: Math.max(0, Number(data?.total ?? items.length) || 0),
    page: Math.max(1, Number(data?.page ?? page) || page),
    pageSize: Math.max(1, Number(data?.pageSize ?? pageSize) || pageSize),
    maxLength: Math.max(100, Math.min(50_000, Number(data?.maxLength) || 50_000)),
    truncatedReplies: Boolean(data?.truncatedReplies),
  };
}

export async function createComment(input: CreateCommentInput) {
  return requestJson<any>("/api/public/comment", {
    method: "POST",
    body: JSON.stringify({ ...input, path: normalizeCommentPath(input.path) }),
  });
}

export async function likeComment(id: string) {
  return requestJson<LikeCommentResult>(
    `/api/public/comment/${encodeURIComponent(id)}/like`,
    { method: "POST", body: "{}" },
  );
}

export async function uploadCommentImage(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file, file.name);
  const response = await fetch("/api/public/comment/image", {
    method: "POST",
    credentials: "same-origin",
    body: form,
  });
  const data = await readApiResponse<{ src?: string }>(
    response,
    `图片上传失败（${response.status}）`,
  );
  if (!data?.src || typeof data.src !== "string") {
    throw new Error("图片上传成功，但服务器没有返回图片地址");
  }
  return data.src;
}

export async function getCommentCounts(paths: string[], signal?: AbortSignal) {
  const params = new URLSearchParams();
  const normalizedPaths = Array.from(new Set(paths.map(normalizeCommentPath))).slice(0, 100);
  // JSON keeps a single path containing a comma unambiguous. The server still
  // accepts the old comma-separated scalar format for third-party clients.
  params.set("paths", JSON.stringify(normalizedPaths));
  return requestJson<Record<string, number>>(`/api/public/comment/count?${params}`, { signal });
}
