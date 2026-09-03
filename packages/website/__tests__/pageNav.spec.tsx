import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RenderItemList } from "../components/PageNav/render";

describe("page navigation presentation", () => {
  it("marks the current page and gives it the light-theme brand color", () => {
    const html = renderToStaticMarkup(
      <RenderItemList
        items={[
          { type: "link", href: "/", page: 1 },
          { type: "link-cur", href: "/page/2", page: 2 },
          { type: "link", href: "/page/3", page: 3 },
        ]}
      />,
    );

    const links = [...html.matchAll(/<a[^>]*>[\s\S]*?<\/a>/g)].map(
      ([link]) => link,
    );
    const currentLink = links.find((link) =>
      link.includes('aria-current="page"'),
    );

    expect(currentLink).toBeDefined();
    expect(currentLink).toContain("bg-[var(--theme-color)]");
    expect(currentLink).toContain("text-white");
    expect(currentLink).toContain("font-semibold");
    expect(currentLink).not.toContain("bg-white");
    expect(currentLink).not.toContain("text-gray-600");
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);

    const ordinaryLinks = links.filter((link) => link !== currentLink);
    expect(ordinaryLinks).toHaveLength(2);
    for (const link of ordinaryLinks) {
      expect(link).toContain("bg-white");
      expect(link).toContain("text-gray-600");
      expect(link).not.toContain("aria-current");
    }
  });
});
