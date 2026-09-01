import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ThemeLogo from "../components/ThemeLogo";

describe("theme-aware site logo", () => {
  it("renders stable light and dark variants for pre-hydration CSS selection", () => {
    const html = renderToStaticMarkup(
      <ThemeLogo
        src="/logo-light.svg"
        darkSrc="/logo-dark.svg"
        alt="Site logo"
        width={52}
        height={52}
      />,
    );

    expect(html).toContain('src="/logo-light.svg"');
    expect(html).toContain('class="dark:hidden"');
    expect(html).toContain('data-theme-logo="light"');
    expect(html).toContain('src="/logo-dark.svg"');
    expect(html).toContain('class="hidden dark:block"');
    expect(html).toContain('data-theme-logo="dark"');
  });

  it("renders only one image when no distinct dark logo is configured", () => {
    const html = renderToStaticMarkup(
      <ThemeLogo src="/logo.svg" darkSrc="/logo.svg" alt="Site logo" />,
    );

    expect(html.match(/<img/g)).toHaveLength(1);
    expect(html).not.toContain("data-theme-logo");
  });
});
