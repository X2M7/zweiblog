import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import AuthorCard, {
  AuthorCardProps,
} from "../components/AuthorCard";
import { Language, SiteLanguageProvider } from "../utils/siteLanguage";

vi.mock("next/router", () => ({
  useRouter: () => ({
    asPath: "/",
    events: { off: vi.fn(), on: vi.fn() },
    isReady: false,
    pathname: "/",
    query: {},
    replace: vi.fn(),
  }),
}));

const option: AuthorCardProps = {
  author: "作者",
  authorEn: "Author",
  desc: "简介",
  descEn: "Description",
  logo: "/author.svg",
  logoDark: "",
  postNum: 10,
  catelogNum: 3,
  tagNum: 8,
  socials: [],
  showSubMenu: "true",
  showRSS: "true",
};

const renderCard = (language: Language) =>
  renderToStaticMarkup(
    <SiteLanguageProvider initialLanguage={language}>
      <AuthorCard option={option} />
    </SiteLanguageProvider>,
  );

describe("author card statistics layout", () => {
  it("keeps the English labels in one full-width row", () => {
    const html = renderCard("en");
    expect(html).toContain(
      'class="flex -mx-10 w-52 justify-center gap-3"',
    );
    const statistics = html.match(
      /<div class="flex -mx-10 w-52 justify-center gap-3" data-testid="author-statistics">([\s\S]*?)<\/div><\/div><div class="mt-4/,
    )?.[1];

    expect(statistics).toContain("Posts");
    expect(statistics).toContain("Categories");
    expect(statistics).toContain("Tags");
    expect(statistics?.match(/whitespace-nowrap/g)).toHaveLength(3);
  });

  it("keeps the Chinese labels in the same non-wrapping row", () => {
    const html = renderCard("zh");
    expect(html).toContain(
      'class="flex -mx-10 w-52 justify-center gap-3"',
    );
    const statistics = html.match(
      /<div class="flex -mx-10 w-52 justify-center gap-3" data-testid="author-statistics">([\s\S]*?)<\/div><\/div><div class="mt-4/,
    )?.[1];

    expect(statistics).toContain("\u65e5\u5fd7");
    expect(statistics).toContain("\u5206\u7c7b");
    expect(statistics).toContain("\u6807\u7b7e");
    expect(statistics?.match(/whitespace-nowrap/g)).toHaveLength(3);
  });
});
