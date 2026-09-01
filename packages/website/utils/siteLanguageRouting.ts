const normalizeLanguage = (value: unknown) => {
  const firstValue = Array.isArray(value) ? value[0] : value;
  return typeof firstValue === "string" ? firstValue.toLowerCase() : "";
};

export function isInternalEnglishPath(pathname: string): boolean {
  return /^\/en(?:\/|$)/.test(String(pathname || ""));
}

export function getNotFoundLanguage(
  queryLanguage: unknown,
  missingPath: unknown,
): "zh" | "en" {
  const explicitLanguage = normalizeLanguage(queryLanguage);
  if (explicitLanguage === "en") return "en";
  if (explicitLanguage === "zh" || explicitLanguage === "zh-cn") return "zh";

  const firstSegment = Array.isArray(missingPath)
    ? missingPath[0]
    : String(missingPath || "").split("/")[0];
  return String(firstSegment || "").toLowerCase() === "en" ? "en" : "zh";
}

const loopbackRewriteHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Build the URL used by Next's internal language rewrite.
 *
 * The bundled Caddy reaches Next over plain HTTP on loopback. An outer TLS
 * proxy can legitimately forward `X-Forwarded-Proto: https`, however, which
 * makes `request.nextUrl` look like `https://localhost:3001`. Reusing that
 * protocol causes Next to attempt TLS against its HTTP-only loopback listener
 * and return 500. Only correct this known internal-hop mismatch; public hosts
 * retain their original protocol.
 */
export function getInternalLanguageRewriteUrl(
  requestUrl: URL,
  rewritePath: string,
): URL {
  const target = new URL(requestUrl.toString());
  target.pathname = rewritePath;
  if (
    target.protocol === "https:" &&
    loopbackRewriteHosts.has(target.hostname.toLowerCase())
  ) {
    target.protocol = "http:";
  }
  return target;
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
