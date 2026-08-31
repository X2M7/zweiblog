import { describe, expect, it } from "vitest";
import {
  getCopyrightText,
  getShareablePageUrl,
} from "../components/CopyRight";
import { codeBlockPlugin } from "../components/Markdown/codeBlock";
import { localizeMarkdownHref } from "../components/Markdown/linkTarget";

describe("localized Markdown presentation", () => {
  it("uses the site language for code-copy prompts without hiding the fenced language", () => {
    const tree: any = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "pre",
          properties: {},
          children: [
            {
              type: "element",
              tagName: "code",
              properties: { className: ["hljs", "language-typescript"] },
              children: [{ type: "text", value: "const value = 1;" }],
            },
          ],
        },
      ],
    };

    codeBlockPlugin("en")(tree);

    const wrapper = tree.children[0].children[0];
    const header = wrapper.children[0];
    const languageTag = header.children[0];
    const copyButton = header.children[1];
    expect(languageTag.children[0].value).toBe("typescript");
    expect(copyButton.properties).toMatchObject({
      "aria-label": "Copy code",
      title: "Copy code",
      "data-copy-success": "Copied.",
    });
  });

  it("inherits language on Markdown internal links and leaves external links alone", () => {
    expect(
      localizeMarkdownHref("/post/hello?preview=1#intro", "en"),
    ).toBe("/post/hello?preview=1&lang=en#intro");
    expect(localizeMarkdownHref("../about#team", "en")).toBe(
      "../about?lang=en#team",
    );
    expect(localizeMarkdownHref("https://example.com/?lang=zh", "en")).toBe(
      "https://example.com/?lang=zh",
    );
    expect(localizeMarkdownHref("#comments", "en")).toBe("#comments");
  });
});

describe("localized copyright presentation", () => {
  it("keeps the complete shareable query string and hash", () => {
    expect(
      getShareablePageUrl({
        protocol: "https:",
        host: "blog.example.com",
        pathname: "/post/hello",
        search: "?preview=1&lang=en",
        hash: "#license",
      }),
    ).toBe("https://blog.example.com/post/hello?preview=1&lang=en#license");
  });

  it("uses independent custom declarations and an English default fallback", () => {
    expect(
      getCopyrightText("zh", "BY-NC-SA", "中文自定义声明", "English custom"),
    ).toBe("中文自定义声明");
    expect(
      getCopyrightText("en", "BY-NC-SA", "中文自定义声明", "English custom"),
    ).toBe("English custom");
    expect(
      getCopyrightText("en", "BY-NC-SA", "中文自定义声明", "   "),
    ).toContain("licensed under the BY-NC-SA license");
  });
});
