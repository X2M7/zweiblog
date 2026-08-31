import type { Article } from "../types/article";

export type ArticleLanguage = "zh" | "en";

export interface ArticleLocalizedState {
  articleId?: number;
  content: string;
  contentEn: string;
  summary: string;
  summaryEn: string;
}

export const ARTICLE_LANGUAGE_STORAGE_KEY = "zweiblog.article-language";

const firstValue = (value: unknown) =>
  Array.isArray(value) ? String(value[0] || "") : String(value || "");

export function hasEnglishArticle(article?: Partial<Article> | null): boolean {
  return Boolean(
    article?.titleEn?.trim() &&
      (article?.contentEn?.trim() || article?.hasEnglishVersion),
  );
}

export function resolveArticleLanguage(
  queryLanguage: unknown,
  englishAvailable: boolean,
  storedLanguage?: unknown,
): ArticleLanguage {
  const requested = firstValue(queryLanguage).toLowerCase();
  if (requested === "zh" || requested === "zh-cn") return "zh";
  if (requested === "en") return englishAvailable ? "en" : "zh";
  return englishAvailable && storedLanguage === "en" ? "en" : "zh";
}

export function resolveEffectiveArticleLanguage(
  language: ArticleLanguage,
  englishAvailable: boolean,
): ArticleLanguage {
  return language === "en" && englishAvailable ? "en" : "zh";
}

export function resolveInitialArticleLanguage(
  article?: Partial<Article> | null,
  requestedLanguage: ArticleLanguage = "zh",
): ArticleLanguage {
  return requestedLanguage === "en" && hasEnglishArticle(article) ? "en" : "zh";
}

export function resolveArticleLanguageFromVisibleUrl(
  pathname: string,
  search: string,
  englishAvailable: boolean,
  storedLanguage?: unknown,
  internalInitialLanguage: ArticleLanguage = "zh",
): ArticleLanguage {
  const requestedLanguage = new URLSearchParams(search).get("lang");
  const internalEnglishFallback = /^\/en\/post(?=\/|$)/.test(pathname)
    ? internalInitialLanguage
    : undefined;
  return resolveArticleLanguage(
    requestedLanguage,
    englishAvailable,
    storedLanguage || internalEnglishFallback,
  );
}

export function getArticleLanguageMetadata(
  articlePath: string,
  language: ArticleLanguage,
) {
  return {
    canonicalHref: language === "en" ? `${articlePath}?lang=en` : articlePath,
    openGraphLocale: language === "en" ? "en_US" : "zh_CN",
  } as const;
}

export function localizeArticle(
  article: Article,
  language: ArticleLanguage,
): Pick<Article, "title" | "content" | "summary"> {
  if (language === "en" && hasEnglishArticle(article)) {
    return {
      title: article.titleEn || article.title,
      content: article.contentEn || article.content,
      // Keep each language independent. When the English summary is empty,
      // the article page derives it from the English body instead of leaking
      // the Chinese summary into English metadata.
      summary: article.summaryEn?.trim() || "",
    };
  }
  return {
    title: article.title,
    content: article.content,
    summary: article.summary?.trim() || "",
  };
}

export function resolveArticleLocalizedFields(
  article: Pick<
    Article,
    "id" | "content" | "contentEn" | "summary" | "summaryEn"
  >,
  localizedState: ArticleLocalizedState,
): Omit<ArticleLocalizedState, "articleId"> {
  if (localizedState.articleId === article.id) {
    return {
      content: localizedState.content,
      contentEn: localizedState.contentEn,
      summary: localizedState.summary,
      summaryEn: localizedState.summaryEn,
    };
  }
  return {
    content: article.content || "",
    contentEn: article.contentEn || "",
    summary: article.summary || "",
    summaryEn: article.summaryEn || "",
  };
}

type ArticleLanguageRouter = {
  pathname: string;
  query: Record<string, string | string[] | undefined>;
  replace: (
    url: {
      pathname: string;
      query: Record<string, string | string[] | undefined>;
    },
    as: string,
    options: { shallow: true; scroll: false },
  ) => Promise<boolean>;
};

/**
 * Keep a language switch on the current Next page module so password-unlocked
 * article bodies are not discarded. A shallow replacement synchronizes both
 * Next's router state and the browser URL without reloading page props, while
 * a refresh of the visible `?lang=en` URL still goes through middleware/SSG.
 */
export function replaceArticleLanguageWithShallowRouting(
  articlePath: string,
  language: ArticleLanguage,
  router: ArticleLanguageRouter,
  currentSearch = "",
  currentHash = "",
): Promise<boolean> {
  const search = new URLSearchParams(currentSearch);
  if (language === "en") search.set("lang", "en");
  else search.delete("lang");

  const query = search.toString();
  const target = `${articlePath}${query ? `?${query}` : ""}${currentHash}`;
  const routerQuery = { ...router.query };
  if (language === "en") routerQuery.lang = "en";
  else delete routerQuery.lang;

  return router.replace(
    { pathname: router.pathname, query: routerQuery },
    target,
    { shallow: true, scroll: false },
  );
}

export function markdownSummary(content: string, maximum = 180): string {
  const plain = String(content || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/^[#>*+\-\d.\s]+/gm, "")
    .replace(/[~*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(plain).slice(0, Math.max(1, maximum)).join("");
}

export function getEnglishArticleRewritePath(
  pathname: string,
  queryLanguage: unknown,
): string | null {
  if (firstValue(queryLanguage).toLowerCase() !== "en") return null;
  const match = pathname.match(/^\/post\/([^/]+)\/?$/);
  return match ? `/en/post/${match[1]}` : null;
}
