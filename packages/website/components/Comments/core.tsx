import React, {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/router';
import {
  CommentPage,
  LocalComment,
  createComment,
  getCommentCounts,
  getComments,
  likeComment,
  MAX_COMMENT_RENDER_DEPTH,
  normalizeCommentPath,
  uploadCommentImage,
} from "../../api/comments";
import CommentMarkdown from "../CommentMarkdown";

const PAGE_SIZE = 10;
const PROFILE_KEY = "zweiblog.local-comment-profile";
const LIKED_KEY = "zweiblog.local-comment-liked";
const COMMENT_MAX_LENGTH = 50_000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const COMMENT_IMAGE_TYPES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);
const EMOJIS = [
  "😀", "😃", "😄", "😁", "😊", "🥰", "😍", "😘",
  "😎", "🤔", "😂", "🤣", "🥲", "😭", "😡", "🤯",
  "👍", "👎", "👏", "🙌", "🙏", "💪", "🤝", "🎉",
  "❤️", "💛", "💚", "💙", "✨", "🔥", "🌈", "🚀",
];
type ReplyTarget = { id: string; rootId: string; nick: string };
type Profile = { nick: string; mail: string; link: string };
type ToolPanel = "emoji" | "image" | null;

function safeProfile(): Profile {
  if (typeof window === "undefined") return { nick: "", mail: "", link: "" };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PROFILE_KEY) || "{}");
    return {
      nick: typeof parsed.nick === "string" ? parsed.nick.slice(0, 64) : "",
      mail: typeof parsed.mail === "string" ? parsed.mail.slice(0, 254) : "",
      link: typeof parsed.link === "string" ? parsed.link.slice(0, 500) : "",
    };
  } catch {
    return { nick: "", mail: "", link: "" };
  }
}

function hasStoredProfile() {
  if (typeof window === "undefined") return false;
  try {
    return Boolean(window.localStorage.getItem(PROFILE_KEY));
  } catch {
    return false;
  }
}

function storeProfile(profile: Profile, remember: boolean) {
  try {
    if (remember) {
      window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    } else {
      window.localStorage.removeItem(PROFILE_KEY);
    }
  } catch {
    // Comments remain usable when storage is unavailable or full.
  }
}

function safeLikedIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LIKED_KEY) || "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function normalizeLink(link?: string) {
  if (!link) return undefined;
  try {
    const parsed = new URL(link);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

function displayTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("zh-CN", { hour12: false });
}

function Avatar({ nick }: { nick: string }) {
  const label = Array.from(nick.trim() || "访").slice(0, 2).join("");
  let hue = 0;
  Array.from(nick).forEach((char) => {
    hue = (hue * 31 + (char.codePointAt(0) || 0)) % 360;
  });
  return (
    <span
      aria-hidden="true"
      className="flex h-10 w-10 shrink-0 select-none items-center justify-center rounded-full text-sm font-semibold text-white"
      style={{ backgroundColor: `hsl(${hue} 55% 45%)` }}
    >
      {label}
    </span>
  );
}

function Icon({ children, className = "h-5 w-5" }: React.PropsWithChildren<{ className?: string }>) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      {children}
    </svg>
  );
}

function EmojiIcon() {
  return <Icon><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9h.01M15 9h.01" /></Icon>;
}

function ImageIcon() {
  return <Icon><rect height="16" rx="2" width="19" x="2.5" y="4" /><circle cx="8" cy="9" r="1.5" /><path d="m4.5 18 5-5 3 3 2-2 5 4" /></Icon>;
}

function PreviewIcon() {
  return <Icon><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.5" /></Icon>;
}

function HeartIcon({ active }: { active: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill={active ? "currentColor" : "none"}
      stroke="currentColor"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" />
    </svg>
  );
}

function ReplyIcon() {
  return <Icon className="h-4 w-4"><path d="m9 17-5-5 5-5M4 12h9a7 7 0 0 1 7 7" /></Icon>;
}

function updateLike(
  comment: LocalComment,
  id: string,
  likes: number,
  depth = 0,
): LocalComment {
  if (comment.id === id) return { ...comment, likes };
  if (depth >= MAX_COMMENT_RENDER_DEPTH) return comment;
  return {
    ...comment,
    replies: comment.replies.map((reply) => updateLike(reply, id, likes, depth + 1)),
  };
}

function mergeServerLiked(comments: LocalComment[], current: Set<string>) {
  const next = new Set(current);
  const visit = (comment: LocalComment, depth = 0) => {
    if (typeof comment.liked === "boolean") {
      if (comment.liked) next.add(comment.id);
      else next.delete(comment.id);
    }
    if (depth < MAX_COMMENT_RENDER_DEPTH) {
      comment.replies.forEach((reply) => visit(reply, depth + 1));
    }
  };
  comments.forEach((comment) => visit(comment));
  return next;
}

export function CommentItem({
  comment,
  rootId,
  depth = 0,
  liked,
  liking,
  onReply,
  onLike,
}: {
  comment: LocalComment;
  rootId: string;
  depth?: number;
  liked: Set<string>;
  liking?: Set<string>;
  onReply: (target: ReplyTarget) => void;
  onLike: (comment: LocalComment) => void;
}) {
  const link = comment.deleted ? undefined : normalizeLink(comment.link);
  const environment = [comment.location, comment.browser, comment.os].filter(Boolean);
  return (
    <article
      className={`${depth ? "mt-4 border-l-2 border-slate-200 pl-3 dark:border-gray-700" : "py-5"} ${
        comment.deleted ? "opacity-70" : ""
      }`}
    >
      <div className="flex gap-3">
        {!comment.deleted && <Avatar nick={comment.nick} />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            {link ? (
              <a
                className="font-medium text-sky-700 hover:underline dark:text-sky-400"
                href={link}
                rel="nofollow noopener noreferrer ugc"
                target="_blank"
              >
                {comment.nick}
              </a>
            ) : (
              <span className="font-medium text-gray-800 dark:text-gray-200">{comment.nick}</span>
            )}
            {comment.isAdmin && (
              <span className="rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-700 dark:bg-slate-700 dark:text-sky-300">
                站长
              </span>
            )}
            {comment.replyToNick && <span className="text-xs text-gray-500">回复 @{comment.replyToNick}</span>}
            <time className="text-xs text-gray-400" dateTime={comment.createdAt}>
              {displayTime(comment.createdAt)}
            </time>
          </div>
          {!comment.deleted && environment.length > 0 && (
            <p
              aria-label="评论者所在地区与设备"
              className="mt-1 text-xs text-gray-400"
              title={environment.join(" · ")}
            >
              {environment.join(" · ")}
            </p>
          )}
          <div className="mt-2 overflow-hidden text-sm text-gray-700 dark:text-gray-300">
            {comment.deleted ? (
              <p className="italic text-gray-400">该评论已删除</p>
            ) : (
              <>
                <CommentMarkdown content={comment.content} />
                {comment.contentTruncated && (
                  <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                    这条旧评论超过 50000 个字符，公开页面已截断；完整内容仍保存在本地备份与后台。
                  </p>
                )}
              </>
            )}
          </div>
          {!comment.deleted && (
            <div className="mt-2 flex items-center justify-end gap-1 text-xs text-gray-500">
              <button
                aria-label={liked.has(comment.id) ? "取消点赞" : "点赞"}
                className={`inline-flex min-h-[32px] min-w-[32px] items-center justify-center gap-1 rounded px-2 hover:bg-slate-100 hover:text-rose-500 disabled:cursor-wait disabled:opacity-50 dark:hover:bg-slate-800 ${
                  liked.has(comment.id) ? "text-rose-500" : ""
                }`}
                disabled={liking?.has(comment.id)}
                onClick={() => onLike(comment)}
                title={liked.has(comment.id) ? "取消点赞" : "点赞"}
                type="button"
              >
                <HeartIcon active={liked.has(comment.id)} />
                {comment.likes > 0 && <span aria-hidden="true">{comment.likes}</span>}
              </button>
              <button
                aria-label={`回复 ${comment.nick}`}
                className="inline-flex min-h-[32px] min-w-[32px] items-center justify-center rounded hover:bg-slate-100 hover:text-sky-600 dark:hover:bg-slate-800"
                onClick={() => onReply({ id: comment.id, rootId, nick: comment.nick })}
                title={`回复 ${comment.nick}`}
                type="button"
              >
                <ReplyIcon />
              </button>
            </div>
          )}
          {comment.replies.map((reply) => (
            <CommentItem
              comment={reply}
              depth={depth + 1}
              key={reply.id}
              liked={liked}
              liking={liking}
              onLike={onLike}
              onReply={onReply}
              rootId={rootId}
            />
          ))}
          {comment.repliesTruncated && (
            <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
              回复层级过深，后续内容已折叠。
            </p>
          )}
        </div>
      </div>
    </article>
  );
}

function CountLoader() {
  const router = useRouter();
  useEffect(() => {
    const controller = new AbortController();
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>(".local-comment-count"),
    );
    const paths = Array.from(
      new Set(
        nodes
          .map((node) => node.dataset.path)
          .filter((path): path is string => Boolean(path)),
      ),
    );
    if (!paths.length) return () => controller.abort();
    getCommentCounts(paths, controller.signal)
      .then((counts) => {
        nodes.forEach((node) => {
          const path = node.dataset.path;
          if (path) {
            const normalizedPath = normalizeCommentPath(path);
            node.textContent = String(Math.max(0, Number(counts?.[normalizedPath]) || 0));
          }
        });
      })
      .catch((error) => {
        if (error?.name !== "AbortError") console.warn("评论计数加载失败", error);
      });
    return () => controller.abort();
  }, [router.asPath]);
  return null;
}

function CommentPanel() {
  const router = useRouter();
  const [path, setPath] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CommentPage>({
    items: [],
    total: 0,
    page: 1,
    pageSize: PAGE_SIZE,
    maxLength: COMMENT_MAX_LENGTH,
    truncatedReplies: false,
  });
  const [profile, setProfile] = useState<Profile>({ nick: "", mail: "", link: "" });
  const [rememberProfile, setRememberProfile] = useState(false);
  const [content, setContent] = useState("");
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  const [toolPanel, setToolPanel] = useState<ToolPanel>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [imageAlt, setImageAlt] = useState("");
  const [preview, setPreview] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [toolNotice, setToolNotice] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const [liking, setLiking] = useState<Set<string>>(new Set());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef("");
  const uploadGenerationRef = useRef(0);

  useEffect(() => {
    setProfile(safeProfile());
    setRememberProfile(hasStoredProfile());
    setLiked(safeLikedIds());
  }, []);

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  useEffect(() => {
    // Next can reuse this component while navigating between posts. Reset all
    // target-specific state so a draft/reply can never be sent to the previous
    // article and comment counts are refreshed after client-side navigation.
    const routePath = router.asPath?.split(/[?#]/, 1)[0] || window.location.pathname || "/";
    setPath(routePath);
    uploadGenerationRef.current += 1;
    setPage(1);
    setContent("");
    setReplyTo(null);
    setToolPanel(null);
    setImageUrl("");
    setImageAlt("");
    setPreview(false);
    setUploading(false);
    setToolNotice("");
    setMessage("");
    setError("");
  }, [router.asPath]);

  const load = useCallback((currentPath: string, currentPage: number) => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    getComments(currentPath, currentPage, PAGE_SIZE, controller.signal)
      .then((nextData) => {
        setData(nextData);
        setLiked((current) => mergeServerLiked(nextData.items, current));
      })
      .catch((caught) => {
        if (caught?.name !== "AbortError") setError(caught?.message || "评论加载失败");
      })
      .finally(() => setLoading(false));
    return controller;
  }, []);

  useEffect(() => {
    if (!path) return;
    const controller = load(path, page);
    return () => controller.abort();
  }, [load, page, path]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(data.total / Math.max(1, data.pageSize))),
    [data],
  );

  const insertAtCursor = useCallback((value: string) => {
    const textarea = textareaRef.current;
    const current = textarea?.value ?? contentRef.current;
    const start = textarea?.selectionStart ?? current.length;
    const end = textarea?.selectionEnd ?? start;
    const next = `${current.slice(0, start)}${value}${current.slice(end)}`;
    if (next.length > data.maxLength) {
      setError(`评论最多 ${data.maxLength} 个字符`);
      return false;
    }
    contentRef.current = next;
    setContent(next);
    setError("");
    window.requestAnimationFrame(() => {
      textarea?.focus();
      const cursor = start + value.length;
      textarea?.setSelectionRange(cursor, cursor);
    });
    return true;
  }, [data.maxLength]);

  const insertImage = useCallback((src: string, alt: string) => {
    const safeAlt = (alt.trim() || "图片").replace(/\\/g, "\\\\").replace(/]/g, "\\]");
    const safeSrc = src.trim().replace(/\s/g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");
    return insertAtCursor(`\n![${safeAlt}](${safeSrc})\n`);
  }, [insertAtCursor]);

  const insertNetworkImage = () => {
    setToolNotice("");
    setError("");
    let parsed: URL;
    try {
      parsed = new URL(imageUrl.trim());
    } catch {
      setError("请输入完整的 HTTP 或 HTTPS 图片地址");
      return;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      setError("网络图片仅支持 HTTP 或 HTTPS 地址");
      return;
    }
    if (insertImage(parsed.href, imageAlt)) {
      setImageUrl("");
      setImageAlt("");
      setToolPanel(null);
      setToolNotice("已在光标处插入网络图片");
    }
  };

  const uploadImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setError("");
    setMessage("");
    setToolNotice("");
    if (!COMMENT_IMAGE_TYPES.has(file.type.toLowerCase())) {
      setError("仅支持 PNG、JPG、GIF 和 WebP 图片");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError("图片不能超过 5 MB");
      return;
    }
    const uploadGeneration = ++uploadGenerationRef.current;
    setUploading(true);
    setToolNotice(`正在上传 ${file.name}…`);
    try {
      const src = await uploadCommentImage(file);
      if (uploadGeneration !== uploadGenerationRef.current) return;
      if (insertImage(src, imageAlt || file.name.replace(/\.[^.]+$/, ""))) {
        setImageAlt("");
        setToolPanel(null);
        setToolNotice("图片已上传并插入评论，提交评论后即可公开显示");
      }
    } catch (caught: any) {
      if (uploadGeneration !== uploadGenerationRef.current) return;
      setToolNotice("");
      setError(caught?.message || "图片上传失败");
    } finally {
      if (uploadGeneration === uploadGenerationRef.current) setUploading(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setMessage("");
    if (uploading) return setError("请等待图片上传完成");
    if (!content.trim()) return setError("请填写评论内容");
    setSubmitting(true);
    try {
      const result = await createComment({
        path,
        nick: profile.nick.trim(),
        mail: profile.mail.trim() || undefined,
        link: profile.link.trim() || undefined,
        content: content.trim(),
        parentId: replyTo?.rootId,
        replyToId: replyTo?.id,
      });
      storeProfile(profile, rememberProfile);
      setContent("");
      contentRef.current = "";
      setReplyTo(null);
      setToolPanel(null);
      setToolNotice("");
      setPreview(false);
      const pending = result?.moderated || result?.status === "pending" || result?.comment?.status === "pending";
      setMessage(pending ? "评论已保存，审核通过后会公开显示。" : "评论发布成功。所有数据仅保存在本站。");
      if (!pending) page === 1 ? load(path, 1) : setPage(1);
    } catch (caught: any) {
      setError(caught?.message || "评论发布失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleLike = async (comment: LocalComment) => {
    if (!comment.id || comment.deleted || liking.has(comment.id)) return;
    setLiking((current) => new Set(current).add(comment.id));
    setError("");
    try {
      const result = await likeComment(comment.id);
      const next = new Set(liked);
      const nextLiked = typeof result?.liked === "boolean" ? result.liked : !next.has(comment.id);
      if (nextLiked) next.add(comment.id);
      else next.delete(comment.id);
      setLiked(next);
      try {
        window.localStorage.setItem(LIKED_KEY, JSON.stringify(Array.from(next).slice(-500)));
      } catch {
        // Private browsing and full storage must not turn a successful server
        // like into a false failure in the UI.
      }
      const serverLikes = Number(result?.likes);
      const nextLikes = Number.isFinite(serverLikes)
        ? Math.max(0, serverLikes)
        : Math.max(0, comment.likes + (nextLiked ? 1 : -1));
      setData((current) => ({
        ...current,
        items: current.items.map((item) => updateLike(item, comment.id, nextLikes)),
      }));
    } catch (caught: any) {
      setError(caught?.message || "点赞失败");
    } finally {
      setLiking((current) => {
        const next = new Set(current);
        next.delete(comment.id);
        return next;
      });
    }
  };

  return (
    <section className="mt-4 bg-white px-4 py-5 text-gray-700 dark:bg-dark dark:text-dark md:px-6" id="comments">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">评论 {data.total || ""}</h2>
        <span className="text-xs text-gray-400">本地存储 · Markdown / TeX</span>
      </div>
      <form className="rounded border border-slate-200 p-3 dark:border-gray-700" onSubmit={submit}>
        <div className="grid gap-2 md:grid-cols-3">
          <input
            autoComplete="nickname"
            className="rounded border border-slate-200 bg-transparent px-3 py-2 outline-none focus:border-sky-500 dark:border-gray-700"
            maxLength={64}
            onChange={(event) => setProfile({ ...profile, nick: event.target.value })}
            placeholder="昵称（可选，留空匿名）"
            value={profile.nick}
          />
          <input
            autoComplete="email"
            className="rounded border border-slate-200 bg-transparent px-3 py-2 outline-none focus:border-sky-500 dark:border-gray-700"
            maxLength={254}
            onChange={(event) => setProfile({ ...profile, mail: event.target.value })}
            placeholder="邮箱（仅站长可见）"
            type="email"
            value={profile.mail}
          />
          <input
            autoComplete="url"
            className="rounded border border-slate-200 bg-transparent px-3 py-2 outline-none focus:border-sky-500 dark:border-gray-700"
            maxLength={500}
            onChange={(event) => setProfile({ ...profile, link: event.target.value })}
            placeholder="个人网址（可选）"
            type="url"
            value={profile.link}
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
          <label className="inline-flex cursor-pointer items-center gap-2">
            <input
              checked={rememberProfile}
              onChange={(event) => {
                const remember = event.target.checked;
                setRememberProfile(remember);
                if (!remember) storeProfile(profile, false);
              }}
              type="checkbox"
            />
            在此设备记住昵称、邮箱和网址
          </label>
          <button
            className="hover:text-sky-600"
            onClick={() => {
              storeProfile(profile, false);
              setProfile({ nick: "", mail: "", link: "" });
              setRememberProfile(false);
            }}
            type="button"
          >
            清除本地资料
          </button>
        </div>
        {replyTo && (
          <div className="mt-3 flex items-center justify-between rounded bg-sky-50 px-3 py-2 text-sm text-sky-800 dark:bg-slate-800 dark:text-sky-300">
            <span>正在回复 @{replyTo.nick}</span>
            <button onClick={() => setReplyTo(null)} type="button">取消</button>
          </div>
        )}
        <textarea
          className="mt-3 min-h-[150px] w-full resize-y bg-transparent px-2 py-3 outline-none"
          maxLength={data.maxLength}
          onChange={(event) => {
            contentRef.current = event.target.value;
            setContent(event.target.value);
          }}
          placeholder={"支持 Markdown、网络图片与 TeX，例如：$E = mc^2$ 或 $$\\int_0^1 x^2 dx$$"}
          ref={textareaRef}
          value={content}
        />
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 py-2 text-xs dark:border-gray-700">
          <div aria-label="评论编辑工具" className="flex items-center gap-1" role="toolbar">
            <button
              aria-expanded={toolPanel === "emoji"}
              aria-label="插入表情"
              className={`inline-flex h-9 w-9 items-center justify-center rounded hover:bg-slate-100 hover:text-sky-600 dark:hover:bg-slate-800 ${
                toolPanel === "emoji" ? "bg-slate-100 text-sky-600 dark:bg-slate-800" : ""
              }`}
              onClick={() => setToolPanel((current) => current === "emoji" ? null : "emoji")}
              title="插入表情"
              type="button"
            >
              <EmojiIcon />
            </button>
            <button
              aria-expanded={toolPanel === "image"}
              aria-label="插入图片"
              className={`inline-flex h-9 w-9 items-center justify-center rounded hover:bg-slate-100 hover:text-sky-600 dark:hover:bg-slate-800 ${
                toolPanel === "image" ? "bg-slate-100 text-sky-600 dark:bg-slate-800" : ""
              }`}
              disabled={uploading}
              onClick={() => setToolPanel((current) => current === "image" ? null : "image")}
              title="上传本地图片或插入网络图片"
              type="button"
            >
              <ImageIcon />
            </button>
            <button
              aria-expanded={preview}
              aria-label={preview ? "收起预览" : "展开预览"}
              className={`inline-flex h-9 w-9 items-center justify-center rounded hover:bg-slate-100 hover:text-sky-600 dark:hover:bg-slate-800 ${
                preview ? "bg-slate-100 text-sky-600 dark:bg-slate-800" : ""
              }`}
              onClick={() => setPreview((current) => !current)}
              title={preview ? "收起预览" : "预览 Markdown 与 TeX"}
              type="button"
            >
              <PreviewIcon />
            </button>
          </div>
          <span className="text-gray-400">{content.length}/{data.maxLength} · 请勿提交隐私信息</span>
        </div>
        {toolPanel === "emoji" && (
          <div className="grid grid-cols-8 gap-1 border-t border-slate-100 px-2 py-3 sm:grid-cols-12 dark:border-gray-700">
            {EMOJIS.map((emoji) => (
              <button
                aria-label={`插入表情 ${emoji}`}
                className="rounded p-1.5 text-xl hover:bg-slate-100 dark:hover:bg-slate-800"
                key={emoji}
                onClick={() => insertAtCursor(emoji)}
                title={`插入 ${emoji}`}
                type="button"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
        {toolPanel === "image" && (
          <div className="space-y-3 border-t border-slate-100 px-2 py-3 dark:border-gray-700">
            <div className="flex flex-wrap items-center gap-2">
              <input
                accept="image/gif,image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={uploadImage}
                ref={fileInputRef}
                type="file"
              />
              <button
                className="rounded border border-slate-200 px-3 py-2 text-sm hover:border-sky-500 hover:text-sky-600 disabled:cursor-wait disabled:opacity-50 dark:border-gray-700"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                type="button"
              >
                {uploading ? "上传中…" : "上传本地图片"}
              </button>
              <span className="text-xs text-gray-400">支持 PNG、JPG、GIF、WebP，最大 5 MB</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-[1fr_12rem_auto]">
              <input
                className="rounded border border-slate-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-sky-500 dark:border-gray-700"
                onChange={(event) => setImageUrl(event.target.value)}
                placeholder="https://example.com/image.png"
                type="url"
                value={imageUrl}
              />
              <input
                className="rounded border border-slate-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-sky-500 dark:border-gray-700"
                maxLength={120}
                onChange={(event) => setImageAlt(event.target.value)}
                placeholder="图片描述（可选）"
                value={imageAlt}
              />
              <button
                className="rounded bg-slate-700 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50"
                disabled={!imageUrl.trim() || uploading}
                onClick={insertNetworkImage}
                type="button"
              >
                插入网络图片
              </button>
            </div>
          </div>
        )}
        {toolNotice && (
          <p aria-live="polite" className="border-t border-slate-100 px-2 py-2 text-xs text-sky-600 dark:border-gray-700 dark:text-sky-400">
            {toolNotice}
          </p>
        )}
        {preview && (
          <div className="min-h-[100px] border-t border-slate-100 px-2 py-3 dark:border-gray-700">
            <p className="mb-2 text-xs font-medium text-gray-400">预览（Markdown / TeX）</p>
            {content.trim() ? <CommentMarkdown content={content} /> : <span className="text-sm text-gray-400">暂无预览内容</span>}
          </div>
        )}
        <div className="flex justify-end border-t border-slate-100 pt-3 dark:border-gray-700">
          <button
            className="rounded bg-sky-600 px-5 py-2 text-sm text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={submitting || uploading}
            type="submit"
          >
            {uploading ? "图片上传中…" : submitting ? "提交中…" : replyTo ? "提交回复" : "发表评论"}
          </button>
        </div>
      </form>
      {message && <p className="mt-3 rounded bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-slate-800 dark:text-green-400">{message}</p>}
      {error && <p className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-slate-800 dark:text-red-400">{error}</p>}
      <div className="mt-3 divide-y divide-slate-100 dark:divide-gray-700">
        {loading ? (
          <p className="py-8 text-center text-sm text-gray-400">评论加载中…</p>
        ) : data.items.length ? (
          data.items.map((comment) => (
            <CommentItem
              comment={comment}
              key={comment.id}
              liked={liked}
              liking={liking}
              onLike={handleLike}
              onReply={(target) => {
                setReplyTo(target);
                setPreview(false);
                setToolPanel(null);
                textareaRef.current?.focus();
              }}
              rootId={comment.id}
            />
          ))
        ) : (
          <p className="py-8 text-center text-sm text-gray-400">还没有评论，来留下第一条吧。</p>
        )}
      </div>
      {data.truncatedReplies && (
        <p className="mt-3 rounded bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-slate-800 dark:text-amber-400">
          本页回复数量过多，部分回复未加载，请由站长清理或拆分页查看。
        </p>
      )}
      {totalPages > 1 && (
        <nav aria-label="评论分页" className="mt-4 flex items-center justify-center gap-3 text-sm">
          <button className="rounded border px-3 py-1 disabled:opacity-40" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} type="button">上一页</button>
          <span>{page} / {totalPages}</span>
          <button className="rounded border px-3 py-1 disabled:opacity-40" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)} type="button">下一页</button>
        </nav>
      )}
    </section>
  );
}

export default function LocalComments(props: { enable: "true" | "false"; visible: boolean }) {
  if (!props.enable || props.enable === "false") return null;
  return props.visible ? <CommentPanel /> : <CountLoader />;
}
