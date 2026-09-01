import { describe, expect, it } from "vitest";

import {
  EXTERNAL_LATEX_DARK_COLOR,
  getExternalLatexThemeUrl,
  normalizeExternalLatexUrl,
  synchronizeExternalLatexImage,
} from "../components/Markdown/externalLatex";

function fakeImage(initial: Record<string, string>) {
  const attributes = new Map(Object.entries(initial));
  return {
    currentSrc: "",
    getAttribute: (name: string) => attributes.get(name) ?? null,
    hasAttribute: (name: string) => attributes.has(name),
    removeAttribute: (name: string) => attributes.delete(name),
    setAttribute: (name: string, value: string) => attributes.set(name, value),
  } as unknown as HTMLImageElement;
}

describe("external LaTeX image theme URLs", () => {
  it("uses the existing renderer and adds its dark foreground parameter", () => {
    expect(getExternalLatexThemeUrl("https://tex.xumin.net/svg/x%5E2", true)).toBe(
      `https://tex.xumin.net/svg/x%5E2?c=${EXTERNAL_LATEX_DARK_COLOR}`,
    );
    expect(
      getExternalLatexThemeUrl("//tex.xumin.net/svgb/encoded?cache=1", true),
    ).toBe(
      `https://tex.xumin.net/svgb/encoded?cache=1&c=${EXTERNAL_LATEX_DARK_COLOR}`,
    );
  });

  it("restores the color-neutral URL in the light theme", () => {
    expect(
      getExternalLatexThemeUrl(
        "https://tex.xumin.net/svg/x%5E2?cache=1&color=fff&c=000",
        false,
      ),
    ).toBe("https://tex.xumin.net/svg/x%5E2?cache=1");
  });

  it("does not rewrite other origins, paths, or protocols", () => {
    const sources = [
      "https://images.example/formula.svg",
      "https://tex.xumin.net/logo.svg",
      "https://tex.xumin.net.evil.example/svg/x",
      "http://tex.xumin.net/svg/x",
      "/svg/x",
      "javascript:alert(1)",
    ];

    for (const source of sources) {
      expect(normalizeExternalLatexUrl(source)).toBeNull();
      expect(getExternalLatexThemeUrl(source, true)).toBeNull();
    }
  });

  it("updates an image when the theme changes without retaining a dark URL", () => {
    const image = fakeImage({
      src: "//tex.xumin.net/svg/x%5E2",
      srcset: "https://images.example/wrong.svg 2x",
    });

    synchronizeExternalLatexImage(image, true);
    expect(image.getAttribute("src")).toBe(
      `https://tex.xumin.net/svg/x%5E2?c=${EXTERNAL_LATEX_DARK_COLOR}`,
    );
    expect(image.getAttribute("data-zweiblog-latex-source")).toBe(
      "https://tex.xumin.net/svg/x%5E2",
    );
    expect(image.getAttribute("srcset")).toBeNull();

    synchronizeExternalLatexImage(image, false);
    expect(image.getAttribute("src")).toBe("https://tex.xumin.net/svg/x%5E2");
  });
});
