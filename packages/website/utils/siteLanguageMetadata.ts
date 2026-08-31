import type { Language } from "./siteLanguage";

const removeInternalEnglishPrefix = (pathname: string) => {
  if (pathname === "/en" || pathname === "/en/") return "/";
  return pathname.replace(/^\/en(?=\/)/, "") || "/";
};

const withSearch = (pathname: string, params: URLSearchParams) => {
  const search = params.toString();
  return `${pathname}${search ? `?${search}` : ""}`;
};

export function getSiteLanguageMetadata(asPath: string, language: Language) {
  const withoutHash = String(asPath || "/").split("#", 1)[0] || "/";
  const queryIndex = withoutHash.indexOf("?");
  const rawPathname = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const rawSearch = queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : "";
  const pathname = removeInternalEnglishPrefix(rawPathname || "/");
  const commonParams = new URLSearchParams(rawSearch);
  commonParams.delete("lang");

  const zhHref = withSearch(pathname, commonParams);
  const englishParams = new URLSearchParams(commonParams);
  englishParams.set("lang", "en");
  const enHref = withSearch(pathname, englishParams);

  return {
    canonicalHref: language === "en" ? enHref : zhHref,
    enHref,
    xDefaultHref: zhHref,
    zhHref,
  } as const;
}

export function isPostPath(pathname: string): boolean {
  const withoutQuery = String(pathname || "").split(/[?#]/, 1)[0];
  return /^\/(?:en\/)?post(?:\/|$)/.test(withoutQuery);
}
