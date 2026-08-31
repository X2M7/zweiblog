import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/getAllData", () => ({
  getPublicMeta: vi.fn(),
}));

vi.mock("../api/getArticles", () => ({
  getArticleByIdOrPathname: vi.fn(),
  getArticlesByCategory: vi.fn(),
  getArticlesByOption: vi.fn(),
  getArticlesByTimeLine: vi.fn(),
}));

vi.mock("../utils/getLayoutProps", () => ({
  getAuthorCardProps: vi.fn(),
  getLayoutProps: vi.fn(),
}));

import { getPublicMeta } from "../api/getAllData";
import { getArticleByIdOrPathname } from "../api/getArticles";
import {
  resolveCanonicalSearchValue,
  searchArticles,
} from "../api/search";
import { getAuthorCardProps, getLayoutProps } from "../utils/getLayoutProps";
import { getLinkPageProps, getPostPagesProps } from "../utils/getPageProps";

describe("post author language fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getLayoutProps).mockReturnValue({
      showSubMenu: "false",
    } as ReturnType<typeof getLayoutProps>);
    vi.mocked(getPublicMeta).mockResolvedValue({
      meta: {
        siteInfo: {
          author: "站点作者",
          authorEn: "Site Author",
          payAliPay: "",
          payWechat: "",
        },
      },
    } as Awaited<ReturnType<typeof getPublicMeta>>);
  });

  it.each([
    [undefined, "站点作者", "Site Author"],
    ["", "站点作者", "Site Author"],
    ["站点作者", "站点作者", "Site Author"],
    ["客座作者", "客座作者", "客座作者"],
  ])(
    "resolves article author %s without replacing custom authors",
    async (articleAuthor, expectedAuthor, expectedAuthorEn) => {
      vi.mocked(getArticleByIdOrPathname).mockResolvedValue({
        article: { author: articleAuthor },
      } as Awaited<ReturnType<typeof getArticleByIdOrPathname>>);

      const props = await getPostPagesProps("article-id");

      expect(props.author).toBe(expectedAuthor);
      expect(props.authorEn).toBe(expectedAuthorEn);
    },
  );
});

describe("localized category and tag search", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const categories = { 科学: "Science" };
  const tags = { 物理: "Physics" };

  it("maps English display names back to canonical server values", () => {
    expect(
      resolveCanonicalSearchValue(" science ", "en", categories, tags),
    ).toBe("科学");
    expect(
      resolveCanonicalSearchValue("PHYSICS", "en", categories, tags),
    ).toBe("物理");
    expect(
      resolveCanonicalSearchValue("Science", "zh", categories, tags),
    ).toBe("Science");
    expect(
      resolveCanonicalSearchValue("Newton", "en", categories, tags),
    ).toBe("Newton");
  });

  it("sends the resolved canonical value to the public search API", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ data: { data: [] } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const value = resolveCanonicalSearchValue(
      "Physics",
      "en",
      categories,
      tags,
    );
    await searchArticles(value);

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/public/search?value=${encodeURIComponent("物理")}`,
    );
  });
});

describe("link page metadata", () => {
  it("passes the editable page body through with the existing links", async () => {
    const linkPage = {
      updatedAt: "2026-08-31T00:00:00.000Z",
      content: "中文友链正文",
      contentEn: "English links body",
    };
    const links = [{ name: "Friend", url: "https://friend.example" }];
    vi.mocked(getPublicMeta).mockResolvedValue({
      meta: { linkPage, links },
    } as Awaited<ReturnType<typeof getPublicMeta>>);
    vi.mocked(getLayoutProps).mockReturnValue({
      showSubMenu: "false",
    } as ReturnType<typeof getLayoutProps>);
    vi.mocked(getAuthorCardProps).mockReturnValue({
      author: "Author",
    } as ReturnType<typeof getAuthorCardProps>);

    const props = await getLinkPageProps();

    expect(props.linkPage).toEqual(linkPage);
    expect(props.links).toEqual(links);
  });

  it("omits missing legacy link-page metadata so Next can serialize the props", async () => {
    vi.mocked(getPublicMeta).mockResolvedValue({
      meta: { links: [] },
    } as Awaited<ReturnType<typeof getPublicMeta>>);
    vi.mocked(getLayoutProps).mockReturnValue({
      showSubMenu: "false",
    } as ReturnType<typeof getLayoutProps>);
    vi.mocked(getAuthorCardProps).mockReturnValue({
      author: "Author",
    } as ReturnType<typeof getAuthorCardProps>);

    const props = await getLinkPageProps();

    expect(Object.prototype.hasOwnProperty.call(props, "linkPage")).toBe(false);
    expect(() => JSON.stringify(props)).not.toThrow();
  });
});
