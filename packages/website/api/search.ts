import type { Language } from "../utils/siteLanguage";

export function resolveCanonicalSearchValue(
  value: string,
  language: Language,
  categoryNamesEn: Record<string, string>,
  tagNamesEn: Record<string, string>,
): string {
  if (language !== "en") return value;
  const normalizedValue = value.trim().toLocaleLowerCase("en-US");
  if (!normalizedValue) return value;

  const matchedName = [
    ...Object.entries(categoryNamesEn),
    ...Object.entries(tagNamesEn),
  ].find(([, englishName]) =>
    englishName.trim().toLocaleLowerCase("en-US") === normalizedValue,
  );

  return matchedName?.[0] || value;
}

export async function searchArticles(str: string): Promise<any> {
  try {
    const url = `/api/public/search?value=${encodeURIComponent(str)}`;
    const res = await fetch(url);
    const { data } = await res.json();
    return data.data;
  } catch (err) {
    console.log(err);
    throw err;
  }
}
