import React, { createElement } from "react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ArticleList from "../components/ArticleList";
import { CommentItem } from "../components/Comments/core";
import LinkCard from "../components/LinkCard";
import { getLayoutProps } from "../utils/getLayoutProps";
import { SiteLanguageProvider } from "../utils/siteLanguage";
import { getSiteLanguageMetadata, isPostPath } from "../utils/siteLanguageMetadata";

vi.mock("next/router", () => ({
  useRouter: () => ({
    asPath: "/?lang=en",
    events: { off: vi.fn(), on: vi.fn() },
    isReady: false,
    pathname: "/",
    query: { lang: "en" },
    replace: vi.fn(),
  }),
}));

const renderEnglish = (child: ReactNode) =>
  renderToStaticMarkup(
    <SiteLanguageProvider initialLanguage="en">{child}</SiteLanguageProvider>,
  );

describe("site-wide localized content", () => {
  it("builds canonical and alternate URLs without internal route prefixes", () => {
    expect(getSiteLanguageMetadata("/en/category/物理?page=2&lang=en#2026", "en")).toEqual({
      canonicalHref: "/category/物理?page=2&lang=en",
      enHref: "/category/物理?page=2&lang=en",
      xDefaultHref: "/category/物理?page=2",
      zhHref: "/category/物理?page=2",
    });
    expect(getSiteLanguageMetadata("/?lang=zh", "zh").canonicalHref).toBe("/");
    expect(isPostPath("/en/post/example?lang=en")).toBe(true);
    expect(isPostPath("/timeline?lang=en")).toBe(false);
  });

  it("uses English article titles and keeps internal links in English mode", () => {
    const html = renderEnglish(
      createElement(ArticleList, {
        articles: [
          {
            id: 1,
            title: "中文标题",
            titleEn: "English title",
            content: "中文正文",
            contentEn: "English body",
            category: "默认分类",
            tags: [],
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            private: false,
          },
          {
            id: 2,
            title: "回退标题",
            content: "只有中文",
            category: "默认分类",
            tags: [],
            createdAt: "2026-01-02T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z",
            private: false,
          },
        ],
        openArticleLinksInNewWindow: false,
      }),
    );

    expect(html).toContain("English title");
    expect(html).toContain("回退标题");
    expect(html).toContain('/post/1?lang=en');
    expect(html).toContain('/post/2?lang=en');
    expect(html).toContain('lang="en">English title');
    expect(html).toContain('lang="zh-CN">回退标题');
  });

  it("localizes comment controls and administrator labels", () => {
    const html = renderEnglish(
      createElement(CommentItem, {
        comment: {
          id: "comment-1",
          path: "/post/1",
          nick: "Owner",
          content: "Hello",
          createdAt: "2026-01-01T00:00:00.000Z",
          isAdmin: true,
          liked: false,
          likes: 1,
          deleted: false,
          replies: [],
          repliesTruncated: false,
          location: "未知地区",
          browser: "本地网络",
          os: "未知",
        },
        liked: new Set<string>(),
        liking: new Set<string>(),
        onLike: vi.fn(),
        onReply: vi.fn(),
        rootId: "comment-1",
      }),
    );

    expect(html).toContain("Owner");
    expect(html).toContain('aria-label="Like"');
    expect(html).toContain('aria-label="Reply to Owner"');
    expect(html).toContain("Commenter&#x27;s location and device");
    expect(html).toContain("Unknown location · Local network · Unknown");
    expect(html).not.toContain("未知地区");
    expect(html).not.toContain("本地网络");
    expect(html).not.toContain("站长");
  });

  it("localizes administrator-authored link cards with Chinese fallback", () => {
    const english = renderEnglish(
      createElement(LinkCard, {
        link: {
          name: "中文站点",
          nameEn: "English Site",
          desc: "中文简介",
          descEn: "English description",
          logo: "/logo.svg",
          url: "https://example.com",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      }),
    );
    const fallback = renderEnglish(
      createElement(LinkCard, {
        link: {
          name: "仅中文站点",
          desc: "仅中文简介",
          logo: "/logo.svg",
          url: "https://example.org",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      }),
    );

    expect(english).toContain("English Site");
    expect(english).toContain("English description");
    expect(fallback).toContain("仅中文站点");
    expect(fallback).toContain("仅中文简介");
  });

  it("builds category and tag English maps without changing canonical names", () => {
    const layout = getLayoutProps({
      version: "test",
      tags: ["物理"],
      tagDetails: [{ name: "物理", nameEn: "Physics" }],
      totalArticles: 0,
      totalWordCount: 0,
      menus: [],
      meta: {
        about: { content: "", updatedAt: "2026-01-01T00:00:00.000Z" },
        categories: ["科学"],
        categoryDetails: [{ name: "科学", nameEn: "Science" }],
        links: [],
        rewards: [],
        socials: [],
        siteInfo: {
          author: "作者",
          authorDesc: "简介",
          authorLogo: "/logo.svg",
          siteLogo: "/logo.svg",
          favicon: "/logo.svg",
          siteName: "站点",
          siteDesc: "描述",
          copyrightAggreement: "BY-NC-SA",
          beianNumber: "",
          beianUrl: "",
          gaBeianNumber: "",
          gaBeianUrl: "",
          gaBeianLogoUrl: "",
          payAliPay: "",
          payWechat: "",
          since: "2026-01-01T00:00:00.000Z",
          baseUrl: "",
          showDonateInfo: "false",
          showFriends: "true",
          enableComment: "true",
          defaultTheme: "auto",
          enableCustomizing: "false",
          showDonateButton: "false",
          showCopyRight: "true",
          showRSS: "true",
          openArticleLinksInNewWindow: "false",
          showExpirationReminder: "true",
          showEditButton: "false",
        },
      },
    });

    expect(layout.categories).toEqual(["科学"]);
    expect(layout.categoryNamesEn).toEqual({ 科学: "Science" });
    expect(layout.tagNamesEn).toEqual({ 物理: "Physics" });
  });
});
