import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ArticleLanguageSwitch from "../components/ArticleLanguageSwitch";
import { getNeighborArticleHref } from "../components/PostCard/bottom";
import type { Article } from "../types/article";
import {
  getArticleLanguageMetadata,
  getEnglishArticleRewritePath,
  hasEnglishArticle,
  localizeArticle,
  markdownSummary,
  replaceArticleLanguageWithShallowRouting,
  resolveArticleLanguageFromVisibleUrl,
  resolveArticleLocalizedFields,
  resolveEffectiveArticleLanguage,
  resolveInitialArticleLanguage,
  resolveArticleLanguage,
} from "../utils/articleLanguage";

const article: Article = {
  id: 63,
  title: "中文标题",
  titleEn: "English title",
  summary: "中文摘要",
  summaryEn: "English summary",
  content: "# 中文正文",
  contentEn: "# English content",
  category: "计算机",
  tags: ["前端"],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  private: false,
};

describe("article language selection", () => {
  it("uses manually-authored English only when both title and content exist", () => {
    expect(hasEnglishArticle(article)).toBe(true);
    expect(hasEnglishArticle({ ...article, contentEn: "" })).toBe(false);
    expect(
      hasEnglishArticle({
        ...article,
        contentEn: undefined,
        hasEnglishVersion: true,
      }),
    ).toBe(true);
    expect(localizeArticle(article, "en")).toEqual({
      title: "English title",
      summary: "English summary",
      content: "# English content",
    });
  });

  it("honors an explicit query and safely falls back to Chinese", () => {
    expect(resolveArticleLanguage("en", true, "zh")).toBe("en");
    expect(resolveArticleLanguage(["en"], true)).toBe("en");
    expect(resolveArticleLanguage("en", false, "en")).toBe("zh");
    expect(resolveArticleLanguage(undefined, true, "en")).toBe("en");
    expect(resolveArticleLanguage("zh", true, "en")).toBe("zh");
  });

  it("immediately falls back when the reused page state is English but the next article is not", () => {
    const effectiveLanguage = resolveEffectiveArticleLanguage("en", false);
    const incompleteArticle = {
      ...article,
      contentEn: "",
      hasEnglishVersion: false,
    };
    expect(effectiveLanguage).toBe("zh");
    expect(localizeArticle(incompleteArticle, effectiveLanguage).content).toBe(
      "# 中文正文",
    );
    expect(
      getArticleLanguageMetadata("/post/incomplete", effectiveLanguage),
    ).toEqual({
      canonicalHref: "/post/incomplete",
      openGraphLocale: "zh_CN",
    });
    expect(
      getNeighborArticleHref(
        { id: 64, title: "下一篇", pathname: "next", hasEnglishVersion: true },
        effectiveLanguage,
      ),
    ).toBe("/post/next");
    expect(resolveEffectiveArticleLanguage("en", true)).toBe("en");
  });

  it("keeps incomplete English URLs Chinese during SSR", () => {
    const incompleteArticle = {
      ...article,
      contentEn: "",
      hasEnglishVersion: false,
    };
    const initialLanguage = resolveInitialArticleLanguage(
      incompleteArticle,
      "en",
    );

    expect(initialLanguage).toBe("zh");
    expect(localizeArticle(incompleteArticle, initialLanguage).title).toBe(
      "中文标题",
    );
    expect(getArticleLanguageMetadata("/post/translator", initialLanguage)).toEqual(
      {
        canonicalHref: "/post/translator",
        openGraphLocale: "zh_CN",
      },
    );

    const protectedLanguage = resolveInitialArticleLanguage(
      {
        ...article,
        content: "",
        contentEn: "",
        private: true,
        hasEnglishVersion: true,
      },
      "en",
    );
    expect(protectedLanguage).toBe("en");
    expect(
      getArticleLanguageMetadata("/post/private", protectedLanguage),
    ).toEqual({
      canonicalHref: "/post/private?lang=en",
      openGraphLocale: "en_US",
    });
  });

  it("keeps hydration deterministic and corrects history from the visible URL after mount", () => {
    // The initializer is intentionally limited to serialized props so SSR and
    // the first client render cannot disagree during a middleware rewrite.
    expect(resolveInitialArticleLanguage(article, "en")).toBe("en");
    expect(resolveInitialArticleLanguage(article, "zh")).toBe("zh");

    // Once mounted, the real browser URL wins over the restored internal page
    // module. This corrects /en -> clean /post history without hydration risk.
    expect(
      resolveArticleLanguageFromVisibleUrl(
        "/post/translator",
        "",
        true,
        undefined,
        "en",
      ),
    ).toBe("zh");
    expect(
      resolveArticleLanguageFromVisibleUrl(
        "/post/translator",
        "?lang=en",
        true,
        undefined,
        "zh",
      ),
    ).toBe("en");
    expect(
      resolveArticleLanguageFromVisibleUrl(
        "/en/post/translator",
        "",
        true,
        undefined,
        "en",
      ),
    ).toBe("en");
  });

  it("does not reuse a Chinese summary on the English page", () => {
    expect(localizeArticle({ ...article, summaryEn: "" }, "en").summary).toBe("");
  });

  it("creates a bounded plain-text description from Markdown", () => {
    expect(markdownSummary("# Hello\n\n![alt](image.png) **world**", 20)).toBe(
      "Hello alt world",
    );
  });

  it("maps an explicit English article URL to its SSG rewrite target", () => {
    expect(getEnglishArticleRewritePath("/post/translator", "en")).toBe(
      "/en/post/translator",
    );
    expect(getEnglishArticleRewritePath("/post/translator", "zh")).toBeNull();
    expect(getEnglishArticleRewritePath("/category/test", "en")).toBeNull();
  });

  it("only links to an English neighbor when that translation is complete", () => {
    expect(
      getNeighborArticleHref(
        { id: 64, title: "下一篇", pathname: "next", hasEnglishVersion: true },
        "en",
      ),
    ).toBe("/post/next?lang=en");
    expect(
      getNeighborArticleHref(
        { id: 65, title: "未完成", pathname: "partial", hasEnglishVersion: false },
        "en",
      ),
    ).toBe("/post/partial");
    expect(
      getNeighborArticleHref(
        { id: 66, title: "旧文章", hasEnglishVersion: undefined },
        "en",
      ),
    ).toBe("/post/66");
  });

  it("keeps unlocked localized fields without leaking them across articles", () => {
    const unlockedState = {
      articleId: article.id,
      content: "解锁后的中文正文",
      contentEn: "Unlocked English body",
      summary: "解锁后的中文摘要",
      summaryEn: "Unlocked English summary",
    };
    const snapshot = { ...unlockedState };

    const fields = resolveArticleLocalizedFields(article, unlockedState);
    expect(localizeArticle({ ...article, ...fields }, "zh")).toMatchObject({
      content: "解锁后的中文正文",
      summary: "解锁后的中文摘要",
    });
    expect(localizeArticle({ ...article, ...fields }, "en")).toMatchObject({
      content: "Unlocked English body",
      summary: "Unlocked English summary",
    });

    expect(
      resolveArticleLocalizedFields(
        {
          ...article,
          id: article.id + 1,
          content: "Next Chinese body",
          contentEn: "Next English body",
          summary: "Next Chinese summary",
          summaryEn: "Next English summary",
        },
        unlockedState,
      ),
    ).toEqual({
      content: "Next Chinese body",
      contentEn: "Next English body",
      summary: "Next Chinese summary",
      summaryEn: "Next English summary",
    });
    expect(unlockedState).toEqual(snapshot);
  });

  it("uses a same-page shallow replacement for the shareable language URL", async () => {
    const replace = vi.fn().mockResolvedValue(true);
    const router: {
      pathname: string;
      query: Record<string, string | string[] | undefined>;
      replace: typeof replace;
    } = {
      pathname: "/en/post/[id]",
      query: {
        id: "translator",
        lang: "en",
        preview: "1",
      },
      replace,
    };

    await expect(
      replaceArticleLanguageWithShallowRouting(
        "/post/translator",
        "zh",
        router,
        "?lang=en&preview=1",
        "#section",
      ),
    ).resolves.toBe(true);
    expect(replace).toHaveBeenCalledWith(
      {
        pathname: "/en/post/[id]",
        query: { id: "translator", preview: "1" },
      },
      "/post/translator?preview=1#section",
      { shallow: true, scroll: false },
    );

    replace.mockClear();
    router.pathname = "/post/[id]";
    router.query = { id: "translator", preview: "1" };
    await replaceArticleLanguageWithShallowRouting(
      "/post/translator",
      "en",
      router,
      "?preview=1",
    );
    expect(replace).toHaveBeenCalledWith(
      {
        pathname: "/post/[id]",
        query: { id: "translator", preview: "1", lang: "en" },
      },
      "/post/translator?preview=1&lang=en",
      { shallow: true, scroll: false },
    );
  });
});

describe("article language switch", () => {
  it("exposes pressed state and accessible language labels", () => {
    const html = renderToStaticMarkup(
      createElement(ArticleLanguageSwitch, {
        language: "en",
        onChange: vi.fn(),
      }),
    );
    expect(html).toContain("文章语言 / Article language");
    expect(html).toContain('lang="zh-CN"');
    expect(html).toContain('lang="en"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("English");
  });
});
