import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { buildSocialRows } from "../components/SocialCard";
import SocialIcon from "../components/SocialIcon";
import { getIcon } from "../utils/getIcon";
import {
  SOCIAL_CATALOG,
  getSocialDefinition,
  getSocialLabel,
  resolveSocialHref,
  resolveSocialQrSource,
} from "../utils/socialCatalog";
import { SiteLanguageProvider } from "../utils/siteLanguage";

vi.mock("next/router", () => ({
  useRouter: () => ({
    asPath: "/?lang=en",
    isReady: false,
    pathname: "/",
    query: { lang: "en" },
    replace: vi.fn(),
  }),
}));

const expectedTypes = `
website email phone sms address rss linktree custom
wechat wechat-dark wechat-official wechat-channels wecom qq qq-group weibo bilibili douyin kuaishou xiaohongshu zhihu douban juejin csdn segmentfault acfun baidu-tieba coolapk netease-music feishu dingtalk yuque v2ex oschina cnblogs gitee coding
github gitlab bitbucket codeberg stackoverflow stackexchange leetcode codeforces hackerrank kaggle huggingface devto hashnode codepen codesandbox dockerhub
x twitter facebook instagram threads bluesky mastodon linkedin youtube tiktok twitch vimeo reddit pinterest tumblr snapchat quora medium substack wordpress blogger
telegram discord whatsapp signal line kakaotalk viber skype messenger matrix slack microsoft-teams zoom keybase irc xmpp
spotify apple-music soundcloud bandcamp steam epic-games playstation xbox
dribbble behance figma patreon ko-fi buy-me-a-coffee orcid researchgate google-scholar
`.trim().split(/\s+/);

const item = (type: string, value: string) => ({
  type,
  value,
  updatedAt: "2026-08-31T00:00:00.000Z",
});

describe("social contact catalog", () => {
  it("covers the full unique type contract", () => {
    const actual = SOCIAL_CATALOG.map(({ type }) => type);
    expect(actual).toEqual(expectedTypes);
    expect(new Set(actual).size).toBe(actual.length);
    expect(actual).toHaveLength(107);
  });

  it("provides non-empty bilingual labels, kinds, and local icons", () => {
    for (const definition of SOCIAL_CATALOG) {
      expect(definition.label.zh.trim(), definition.type).not.toBe("");
      expect(definition.label.en.trim(), definition.type).not.toBe("");
      expect(["external", "email", "phone", "sms", "qr"]).toContain(
        definition.kind,
      );
      expect(typeof definition.icon, definition.type).toBe("function");
    }

    expect(getSocialLabel("wechat-official", "zh")).toBe("微信公众号");
    expect(getSocialLabel("wechat-official", "en")).toBe(
      "WeChat Official Account",
    );
    expect(getSocialLabel("legacy-network", "en")).toBe("Legacy Network");
  });

  it("resolves each protocol kind and blocks executable URLs", () => {
    expect(getSocialDefinition("wechat").kind).toBe("qr");
    expect(getSocialDefinition("wechat-dark").kind).toBe("qr");
    expect(getSocialDefinition("email").kind).toBe("email");
    expect(getSocialDefinition("phone").kind).toBe("phone");
    expect(getSocialDefinition("sms").kind).toBe("sms");
    expect(getSocialDefinition("legacy-network").kind).toBe("external");

    expect(resolveSocialHref("email", "hello@example.com")).toBe(
      "mailto:hello@example.com",
    );
    expect(resolveSocialHref("email", "mailto:hello@example.com")).toBe(
      "mailto:hello@example.com",
    );
    expect(resolveSocialHref("phone", "+86 138-0000-0000")).toBe(
      "tel:+86 138-0000-0000",
    );
    expect(resolveSocialHref("sms", "sms:10086")).toBe("sms:10086");
    expect(resolveSocialHref("github", "https://github.com/zweiblog")).toBe(
      "https://github.com/zweiblog",
    );
    expect(resolveSocialHref("legacy-network", "https://legacy.example/me")).toBe(
      "https://legacy.example/me",
    );

    for (const unsafe of [
      "javascript:alert(1)",
      "data:text/html,boom",
      "vbscript:msgbox(1)",
      "//evil.example/me",
      "/relative-link",
    ]) {
      expect(resolveSocialHref("website", unsafe)).toBeUndefined();
      expect(resolveSocialHref("legacy-network", unsafe)).toBeUndefined();
    }
  });

  it("only accepts safe local or HTTP(S) QR image sources", () => {
    expect(resolveSocialQrSource("/static/contact/wechat.webp")).toBe(
      "/static/contact/wechat.webp",
    );
    expect(resolveSocialQrSource("https://images.example/wechat.webp")).toBe(
      "https://images.example/wechat.webp",
    );
    expect(resolveSocialQrSource("http://localhost:3000/wechat.png")).toBe(
      "http://localhost:3000/wechat.png",
    );
    expect(resolveSocialQrSource("//evil.example/qr.png")).toBeUndefined();
    expect(resolveSocialQrSource("data:image/svg+xml,<svg />")).toBeUndefined();
    expect(resolveSocialQrSource("javascript:alert(1)")).toBeUndefined();
  });

  it("SSR-renders every icon at 20px with currentColor and falls back for old types", () => {
    for (const definition of SOCIAL_CATALOG) {
      const html = renderToStaticMarkup(getIcon(definition.type, 20));
      expect(html, definition.type).toContain("<svg");
      expect(html, definition.type).toContain('width="20"');
      expect(html, definition.type).toContain('height="20"');
      expect(html, definition.type).toContain("currentColor");
    }

    const fallback = renderToStaticMarkup(getIcon("legacy-network", 20));
    expect(fallback).toContain("<svg");
    expect(fallback).toContain('width="20"');
    expect(fallback).toContain("currentColor");
  });

  it("uses the site language, safe link attributes, and inert unsafe values", () => {
    const english = renderToStaticMarkup(
      <SiteLanguageProvider initialLanguage="en">
        <SocialIcon item={item("wechat-official", "/wechat.png")} />
      </SiteLanguageProvider>,
    );
    expect(english).toContain("WeChat Official Account");
    expect(english).toContain('aria-label="Show WeChat Official Account QR code"');
    expect(english).toContain("<button");
    expect(english).not.toContain("<a");

    const external = renderToStaticMarkup(
      <SocialIcon item={item("github", "https://github.com/zweiblog")} />,
    );
    expect(external).toContain('target="_blank"');
    expect(external).toContain('rel="noopener noreferrer"');

    const unsafe = renderToStaticMarkup(
      <SocialIcon item={item("legacy-network", "javascript:alert(1)")} />,
    );
    expect(unsafe).toContain("Legacy Network");
    expect(unsafe).not.toContain("<a");
    expect(unsafe).not.toContain("javascript:");
  });

  it("hides the dark WeChat companion, merges it, and keeps two columns", () => {
    const rows = buildSocialRows([
      item("wechat", "/wechat-light.png"),
      item("wechat-dark", "/wechat-dark.png"),
      item("github", "https://github.com/zweiblog"),
      item("email", "hello@example.com"),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveLength(2);
    expect(rows[1]).toHaveLength(1);
    expect(rows.flat().map(({ type }) => type)).toEqual([
      "wechat",
      "github",
      "email",
    ]);
    expect(rows[0][0].dark).toBe("/wechat-dark.png");
  });
});
