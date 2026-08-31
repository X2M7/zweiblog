import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("React", React);

vi.mock("next/router", () => ({
  useRouter: () => ({
    asPath: "/link?lang=en",
    isReady: false,
    pathname: "/link",
    query: { lang: "en" },
    replace: vi.fn(),
  }),
}));

vi.mock("../components/Layout", async () => {
  const { createElement } = await import("react");
  return {
    default: ({ children, title }: { children: React.ReactNode; title: string }) =>
      createElement("main", { "data-title": title }, children),
  };
});

vi.mock("../components/AuthorCard", async () => {
  const { createElement } = await import("react");
  return { default: () => createElement("aside", { "data-author-card": true }) };
});

vi.mock("../components/LinkCard", async () => {
  const { createElement } = await import("react");
  return {
    default: ({ link }: { link: { name: string; nameEn?: string } }) =>
      createElement("article", { "data-link-card": true }, link.nameEn || link.name),
  };
});

vi.mock("../components/Markdown", async () => {
  const { createElement } = await import("react");
  return {
    default: ({ content }: { content: string }) =>
      createElement("section", { "data-markdown": true }, content),
  };
});

vi.mock("../components/Comments", async () => {
  const { createElement } = await import("react");
  return { default: () => createElement("div", { "data-comments": true }) };
});

vi.mock("../utils/getPageProps", () => ({ getLinkPageProps: vi.fn() }));
vi.mock("../utils/loadConfig", () => ({ revalidate: {} }));

import { LinkPage, type LinkPageProps } from "../pages/link";
import { resolveLinkPageMarkdown } from "../utils/linkPageContent";
import { SiteLanguageProvider } from "../utils/siteLanguage";

function makeProps(
  linkPage: LinkPageProps["linkPage"],
): LinkPageProps {
  return {
    layoutProps: {
      description: "中文简介",
      descriptionEn: "English description",
      enableComment: "true",
      logo: "/logo.svg",
      siteName: "中文站点",
      siteNameEn: "English Site",
    } as LinkPageProps["layoutProps"],
    authorCardProps: { logo: "/author.svg" } as LinkPageProps["authorCardProps"],
    links: [
      {
        name: "中文友链",
        nameEn: "English Friend",
        desc: "简介",
        logo: "/friend.svg",
        updatedAt: "2026-08-31T00:00:00.000Z",
        url: "https://friend.example",
      },
    ],
    linkPage,
  };
}

function renderLinkPage(
  language: "zh" | "en",
  linkPage: LinkPageProps["linkPage"],
) {
  return renderToStaticMarkup(
    <SiteLanguageProvider initialLanguage={language}>
      <LinkPage {...makeProps(linkPage)} />
    </SiteLanguageProvider>,
  );
}

describe("editable link page Markdown", () => {
  const linkPage = {
    updatedAt: "2026-08-31T00:00:00.000Z",
    content: "中文后台友链正文",
    contentEn: "English editor-authored links body",
  };

  it("renders the selected editor-authored language and keeps the link list", () => {
    const english = renderLinkPage("en", linkPage);
    const chinese = renderLinkPage("zh", linkPage);

    expect(english).toContain("English editor-authored links body");
    expect(english).not.toContain("中文后台友链正文");
    expect(chinese).toContain("中文后台友链正文");
    expect(chinese).not.toContain("English editor-authored links body");
    expect(english).toContain('data-link-card="true"');
    expect(english).toContain("English Friend");
    expect(english).toContain('data-comments="true"');
    expect(english).not.toContain("Link exchange requirements");
  });

  it("falls back to Chinese editor content when English is empty", () => {
    expect(
      resolveLinkPageMarkdown(
        { content: "仅中文正文", contentEn: "" },
        "en",
        "default application",
      ),
    ).toBe("仅中文正文");
  });

  it("preserves the built-in application section for legacy empty metadata", () => {
    const html = renderLinkPage("en", { content: "", contentEn: "" });

    expect(html).toContain("Link exchange requirements");
    expect(html).toContain('data-link-card="true"');
    expect(html).toContain('data-comments="true"');
  });
});
