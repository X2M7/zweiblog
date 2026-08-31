const normalizeLanguage = (value: unknown) => {
  const firstValue = Array.isArray(value) ? value[0] : value;
  return typeof firstValue === "string" ? firstValue.toLowerCase() : "";
};

export function isInternalEnglishPath(pathname: string): boolean {
  return /^\/en(?:\/|$)/.test(String(pathname || ""));
}

export function getEnglishSiteRewritePath(
  pathname: string,
  queryLanguage: unknown,
): string | null {
  if (
    normalizeLanguage(queryLanguage) !== "en" ||
    isInternalEnglishPath(pathname)
  ) {
    return null;
  }
  const supported =
    pathname === "/" ||
    /^\/(?:page\/[^/]+|category(?:\/[^/]+)?|tag(?:\/[^/]+)?|timeline|link|about)\/?$/.test(
      pathname,
    );
  if (!supported) return null;
  return pathname === "/" ? "/en" : `/en${pathname}`;
}

/**
 * Unknown public routes still need an English first render. This helper is
 * called only after all supported page rewrites have been checked.
 */
export function getEnglishNotFoundRewritePath(
  pathname: string,
  queryLanguage: unknown,
): string | null {
  if (
    normalizeLanguage(queryLanguage) !== "en" ||
    isInternalEnglishPath(pathname)
  ) {
    return null;
  }
  return "/en/404";
}
