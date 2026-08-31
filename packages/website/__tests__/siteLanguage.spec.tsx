import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
  getEnglishNotFoundRewritePath,
  getEnglishSiteRewritePath,
  isInternalEnglishPath,
} from "../utils/siteLanguageRouting";

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
    expect(getEnglishNotFoundRewritePath("/missing/page", "en")).toBe(
      "/en/404",
    );
    expect(getEnglishNotFoundRewritePath("/missing/page", "zh")).toBeNull();
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
