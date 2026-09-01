import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { SiteLanguageSwitchView } from "../components/NavBar/languageSwitch";
import { getEnglishMenuName } from "../components/NavBar/item";
import {
  buildLocalizedPath,
  getDocumentLanguage,
  parseLanguage,
  resolveSiteLanguage,
} from "../utils/siteLanguage";
import {
  getEnglishSiteRewritePath,
  getInternalLanguageRewriteUrl,
  getNotFoundLanguage,
  isInternalEnglishPath,
} from "../utils/siteLanguageRouting";
import { middleware } from "../middleware";
import { getServerSideProps as getNotFoundPageProps } from "../pages/[...missing]";

describe("site language utilities", () => {
  it("prefers a shareable query and migrates the old article preference", () => {
    expect(resolveSiteLanguage("en", "zh", "zh")).toBe("en");
    expect(resolveSiteLanguage(undefined, undefined, "en")).toBe("en");
    expect(resolveSiteLanguage("zh-CN", "en", "en")).toBe("zh");
    expect(resolveSiteLanguage("invalid", "invalid", undefined)).toBe("zh");
    expect(parseLanguage(["EN"])).toBe("en");
  });

  it("preserves internal query parameters and hashes", () => {
    expect(buildLocalizedPath("/category/math?page=2#year", "en")).toBe(
      "/category/math?page=2&lang=en#year",
    );
    expect(buildLocalizedPath("/tag/code?lang=en&sort=new", "zh")).toBe(
      "/tag/code?lang=zh&sort=new",
    );
    expect(buildLocalizedPath("https://example.com/?lang=zh", "en")).toBe(
      "https://example.com/?lang=zh",
    );
    expect(buildLocalizedPath("#comments", "en")).toBe("#comments");
  });

  it("maps language values to valid document language tags", () => {
    expect(getDocumentLanguage("zh")).toBe("zh-CN");
    expect(getDocumentLanguage("en")).toBe("en");
  });

  it("rewrites supported English URLs to prerendered internal pages", () => {
    expect(getEnglishSiteRewritePath("/", "en")).toBe("/en");
    expect(getEnglishSiteRewritePath("/page/3", "en")).toBe("/en/page/3");
    expect(getEnglishSiteRewritePath("/category/物理", "en")).toBe(
      "/en/category/物理",
    );
    expect(getEnglishSiteRewritePath("/about", "zh")).toBeNull();
    expect(getEnglishSiteRewritePath("/post/1", "en")).toBeNull();
    expect(isInternalEnglishPath("/en/about")).toBe(true);
    expect(isInternalEnglishPath("/english")).toBe(false);
    expect(isInternalEnglishPath("/energy")).toBe(false);
    expect(getNotFoundLanguage("en", ["missing", "page"])).toBe("en");
    expect(getNotFoundLanguage("zh", ["en", "missing"])).toBe("zh");
    expect(getNotFoundLanguage(undefined, ["en", "missing"])).toBe("en");
    expect(getNotFoundLanguage(undefined, ["missing", "page"])).toBe("zh");
  });

  it("keeps reverse-proxied loopback rewrites on Next's HTTP listener", () => {
    expect(
      getInternalLanguageRewriteUrl(
        new URL("https://localhost:3001/about?lang=en"),
        "/en/about",
      ).toString(),
    ).toBe("http://localhost:3001/en/about?lang=en");
    expect(
      getInternalLanguageRewriteUrl(
        new URL("https://127.0.0.1:3001/post/translator?lang=en"),
        "/en/post/translator",
      ).toString(),
    ).toBe("http://127.0.0.1:3001/en/post/translator?lang=en");
    expect(
      getInternalLanguageRewriteUrl(
        new URL("https://xumin.net/about?lang=en"),
        "/en/about",
      ).toString(),
    ).toBe("https://xumin.net/en/about?lang=en");
    expect(
      getInternalLanguageRewriteUrl(
        new URL("https://localhost:3001/about?lang=en&source=proxy#section"),
        "/en/about",
      ).toString(),
    ).toBe(
      "http://localhost:3001/en/about?lang=en&source=proxy#section",
    );
  });
});

describe("site language middleware rewrites", () => {
  it("preserves queries while correcting only loopback HTTPS rewrites", () => {
    const response = middleware(
      new NextRequest(
        "https://localhost:3001/about?lang=en&source=proxy",
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "http://localhost:3001/en/about?lang=en&source=proxy",
    );
  });

  it("leaves unknown English URLs to the bilingual catch-all 404 page", () => {
    const response = middleware(
      new NextRequest(
        "https://127.0.0.1:3001/missing/page?lang=en&source=proxy",
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.has("x-middleware-rewrite")).toBe(false);
  });

  it("does not downgrade rewrites for a public HTTPS origin", () => {
    const response = middleware(
      new NextRequest("https://blog.example.com/about?lang=en"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "https://blog.example.com/en/about?lang=en",
    );
  });
});

describe("bilingual catch-all page", () => {
  it("returns a real localized HTTP 404 instead of a successful rewrite", async () => {
    const response = { statusCode: 200 };
    const result = (await getNotFoundPageProps({
      params: { missing: ["missing", "page"] },
      query: { lang: "en" },
      res: response,
    } as any)) as any;

    expect(response.statusCode).toBe(404);
    expect(result.props.initialLanguage).toBe("en");
  });
});

describe("site language navigation", () => {
  it("renders the reference diagonal labels as an accessible button", () => {
    const html = renderToStaticMarkup(
      createElement(SiteLanguageSwitchView, {
        language: "en",
        onToggle: vi.fn(),
      }),
    );
    expect(html).toContain("site-language-switch-wrap");
    expect(html).toContain('data-language="en"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Switch to Chinese");
    expect(html).toContain(">中<");
    expect(html).toContain(">En<");
    expect(html).not.toContain('type="checkbox"');
  });

  it("uses administrator-authored menu English before built-in fallbacks", () => {
    expect(getEnglishMenuName("首页", "Start Here")).toBe("Start Here");
    expect(getEnglishMenuName("首页")).toBe("Home");
    expect(getEnglishMenuName("自定义栏目")).toBe("自定义栏目");
  });
});
