import type { BytemdPlugin } from "bytemd";

export const EXTERNAL_LATEX_ORIGIN = "https://tex.xumin.net";
export const EXTERNAL_LATEX_DARK_COLOR = "eaeaea";

const LATEX_PATH_PREFIXES = ["/svg/", "/svgb/"];
const SOURCE_DATA_ATTRIBUTE = "data-zweiblog-latex-source";

export function normalizeExternalLatexUrl(source: unknown): string | null {
  if (typeof source !== "string" || !source.trim()) return null;

  const value = source.trim();
  let url: URL;
  try {
    url = new URL(value.startsWith("//") ? `https:${value}` : value);
  } catch {
    return null;
  }

  if (
    url.origin !== EXTERNAL_LATEX_ORIGIN ||
    !LATEX_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))
  ) {
    return null;
  }

  // c and color are renderer presentation parameters. Keep the stored source
  // neutral so switching back to the light theme restores the black formula.
  url.searchParams.delete("c");
  url.searchParams.delete("color");
  return url.toString();
}

export function getExternalLatexThemeUrl(source: unknown, dark: boolean): string | null {
  const canonical = normalizeExternalLatexUrl(source);
  if (!canonical) return null;

  const url = new URL(canonical);
  if (dark) url.searchParams.set("c", EXTERNAL_LATEX_DARK_COLOR);
  return url.toString();
}

export function synchronizeExternalLatexImage(
  image: HTMLImageElement,
  dark: boolean,
) {
  const currentSource =
    image.getAttribute("data-src") ||
    image.getAttribute("src") ||
    image.currentSrc ||
    "";
  const currentCanonical = normalizeExternalLatexUrl(currentSource);

  if (!currentCanonical) {
    image.removeAttribute(SOURCE_DATA_ATTRIBUTE);
    return;
  }

  const storedCanonical = normalizeExternalLatexUrl(
    image.getAttribute(SOURCE_DATA_ATTRIBUTE),
  );
  const canonical =
    storedCanonical && storedCanonical === currentCanonical
      ? storedCanonical
      : currentCanonical;
  const themed = getExternalLatexThemeUrl(canonical, dark);
  if (!themed) return;

  if (image.getAttribute(SOURCE_DATA_ATTRIBUTE) !== canonical) {
    image.setAttribute(SOURCE_DATA_ATTRIBUTE, canonical);
  }
  if (image.hasAttribute("data-src") && image.getAttribute("data-src") !== themed) {
    image.setAttribute("data-src", themed);
  }
  if (image.getAttribute("src") !== themed) image.setAttribute("src", themed);

  // A responsive/lazy source can override src and silently restore the dark
  // formula to black, so renderer images use their one canonical SVG source.
  image.removeAttribute("srcset");
  image.removeAttribute("data-srcset");
}

export function observeExternalLatexTheme(markdownBody: HTMLElement) {
  const themeRoot = markdownBody.closest(".dark, .light") || document.documentElement;
  const apply = () => {
    const dark = themeRoot.classList.contains("dark");
    markdownBody
      .querySelectorAll<HTMLImageElement>("img")
      .forEach((image) => synchronizeExternalLatexImage(image, dark));
  };

  apply();
  if (typeof MutationObserver === "undefined") return;

  const observer = new MutationObserver(apply);
  observer.observe(themeRoot, { attributes: true, attributeFilter: ["class"] });
  observer.observe(markdownBody, {
    attributes: true,
    attributeFilter: ["src", "srcset", "data-src", "data-srcset"],
    childList: true,
    subtree: true,
  });
  return () => observer.disconnect();
}

export function ExternalLatexTheme(): BytemdPlugin {
  return {
    viewerEffect: ({ markdownBody }) => observeExternalLatexTheme(markdownBody),
  };
}
