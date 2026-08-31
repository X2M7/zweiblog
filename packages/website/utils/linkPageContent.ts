import type { LinkPageContent } from "../api/getAllData";
import type { Language } from "./siteLanguage";

export function resolveLinkPageMarkdown(
  linkPage: LinkPageContent | undefined,
  language: Language,
  defaultContent: string,
): string {
  const localizedContent =
    language === "en" && linkPage?.contentEn?.trim()
      ? linkPage.contentEn
      : linkPage?.content;

  return localizedContent?.trim() ? localizedContent : defaultContent;
}
