import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import Markdown from "../components/Markdown";
import { SiteConfigProvider } from "../utils/siteConfig";

describe("configured-site article embeds", () => {
  it("uses the serialized site base URL during server rendering", () => {
    const html = renderToStaticMarkup(
      <SiteConfigProvider baseUrl="https://xumin.net">
        <Markdown content={'<iframe src="https://xumin.net/c/latex"></iframe>'} />
      </SiteConfigProvider>,
    );

    expect(html).toContain('src="/c/latex"');
    expect(html).not.toContain('src="https://xumin.net/c/latex"');
  });

  it("does not trust an absolute iframe when no site URL was configured", () => {
    const html = renderToStaticMarkup(
      <Markdown content={'<iframe src="https://xumin.net/c/latex"></iframe>'} />,
    );

    expect(html).not.toContain("<iframe");
  });
});
