import { useRouter } from "next/router";
import React, {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type Language = "zh" | "en";

export const SITE_LANGUAGE_STORAGE_KEY = "zweiblog.site-language";
export const LEGACY_ARTICLE_LANGUAGE_STORAGE_KEY =
  "zweiblog.article-language";

const isLanguage = (value: unknown): value is Language =>
  value === "zh" || value === "en";

export function parseLanguage(value: unknown): Language | undefined {
  const normalized = Array.isArray(value) ? value[0] : value;
  if (typeof normalized !== "string") return undefined;
  const language = normalized.toLowerCase();
  if (language === "en") return "en";
  if (language === "zh" || language === "zh-cn") return "zh";
  return undefined;
}

export function resolveSiteLanguage(
  queryLanguage: unknown,
  storedLanguage?: unknown,
  legacyArticleLanguage?: unknown,
  fallback: Language = "zh",
): Language {
  return (
    parseLanguage(queryLanguage) ||
    parseLanguage(storedLanguage) ||
    parseLanguage(legacyArticleLanguage) ||
    fallback
  );
}

/**
 * Adds the explicit site language to an internal URL without losing its
 * existing query string or hash. External, protocol and in-page links are
 * intentionally left alone.
 */
export function buildLocalizedPath(
  href: string,
  language: Language,
): string {
  if (
    !href ||
    href.startsWith("#") ||
    href.startsWith("//") ||
    /^[a-z][a-z\d+.-]*:/i.test(href)
  ) {
    return href;
  }

  const hashIndex = href.indexOf("#");
  const hash = hashIndex >= 0 ? href.slice(hashIndex) : "";
  const withoutHash = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
  const queryIndex = withoutHash.indexOf("?");
  const pathname = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const search = queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : "";
  const params = new URLSearchParams(search);
  params.set("lang", language);
  const query = params.toString();

  return `${pathname}${query ? `?${query}` : ""}${hash}`;
}

export function getDocumentLanguage(language: Language): "zh-CN" | "en" {
  return language === "en" ? "en" : "zh-CN";
}

type SiteLanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  toggleLanguage: () => void;
  t: (zhText: string, enText: string) => string;
  localizedPath: (href: string, languageOverride?: Language) => string;
};

const defaultContext: SiteLanguageContextValue = {
  language: "zh",
  setLanguage: () => undefined,
  toggleLanguage: () => undefined,
  t: (zhText) => zhText,
  localizedPath: (href) => href,
};

const SiteLanguageContext = createContext<SiteLanguageContextValue>(
  defaultContext,
);

function readStoredLanguage(key: string): Language | undefined {
  try {
    return parseLanguage(window.localStorage.getItem(key));
  } catch {
    return undefined;
  }
}

function persistLanguage(language: Language) {
  try {
    // Keep the old article preference synchronized while existing article
    // pages migrate to the site-wide language context.
    window.localStorage.setItem(SITE_LANGUAGE_STORAGE_KEY, language);
    window.localStorage.setItem(
      LEGACY_ARTICLE_LANGUAGE_STORAGE_KEY,
      language,
    );
  } catch {
    // A shareable query parameter still carries the explicit preference when
    // storage is blocked by the browser.
  }
}

function applyDocumentLanguage(language: Language) {
  document.documentElement.lang = getDocumentLanguage(language);
  document.documentElement.dataset.siteLanguage = language;
}

export function SiteLanguageProvider({
  children,
  initialLanguage = "zh",
}: {
  children: ReactNode;
  initialLanguage?: Language;
}) {
  const router = useRouter();
  const [language, setLanguageState] = useState<Language>(initialLanguage);

  const setLanguage = useCallback(
    (nextLanguage: Language) => {
      setLanguageState(nextLanguage);
      persistLanguage(nextLanguage);
      applyDocumentLanguage(nextLanguage);

      if (!router.isReady) return;
      const visiblePath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      const target = buildLocalizedPath(visiblePath, nextLanguage);
      const query = { ...router.query, lang: nextLanguage };
      void router.replace(
        { pathname: router.pathname, query },
        target,
        { shallow: true, scroll: false },
      );
    },
    [router],
  );

  useEffect(() => {
    if (!router.isReady) return;

    const visibleQueryLanguage = parseLanguage(
      new URLSearchParams(window.location.search).get("lang"),
    );
    const storedLanguage = readStoredLanguage(SITE_LANGUAGE_STORAGE_KEY);
    const legacyLanguage = readStoredLanguage(
      LEGACY_ARTICLE_LANGUAGE_STORAGE_KEY,
    );
    // The legacy article switch removes `lang` when returning to Chinese. On
    // article routes its just-written legacy value must therefore win over an
    // older site value during migration.
    const onArticleRoute = /^\/(?:en\/)?post(?:\/|$)/.test(
      window.location.pathname,
    );
    const nextLanguage = visibleQueryLanguage
      ? visibleQueryLanguage
      : onArticleRoute
        ? resolveSiteLanguage(undefined, legacyLanguage, storedLanguage, initialLanguage)
        : resolveSiteLanguage(undefined, storedLanguage, legacyLanguage, initialLanguage);

    setLanguageState(nextLanguage);
    persistLanguage(nextLanguage);
    applyDocumentLanguage(nextLanguage);
  }, [initialLanguage, router.asPath, router.isReady]);

  useEffect(() => {
    applyDocumentLanguage(language);
  }, [language]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (
        event.key !== SITE_LANGUAGE_STORAGE_KEY &&
        event.key !== LEGACY_ARTICLE_LANGUAGE_STORAGE_KEY
      ) {
        return;
      }
      const nextLanguage = parseLanguage(event.newValue);
      if (!nextLanguage || !isLanguage(nextLanguage)) return;
      // Keep the visible URL shareable as well as synchronizing the rendered
      // language across tabs. A reload must not undo the storage event.
      setLanguage(nextLanguage);
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [setLanguage]);

  const value = useMemo<SiteLanguageContextValue>(
    () => ({
      language,
      setLanguage,
      toggleLanguage: () => setLanguage(language === "zh" ? "en" : "zh"),
      t: (zhText, enText) => (language === "en" ? enText : zhText),
      localizedPath: (href, languageOverride) =>
        buildLocalizedPath(href, languageOverride || language),
    }),
    [language, setLanguage],
  );

  return (
    <SiteLanguageContext.Provider value={value}>
      {children}
    </SiteLanguageContext.Provider>
  );
}

export function useSiteLanguage(): SiteLanguageContextValue {
  return useContext(SiteLanguageContext);
}
