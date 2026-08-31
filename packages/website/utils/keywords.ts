import { Article } from "../types/article";

export const getArticlesKeyWord = (
  articles: Article[],
  language: "zh" | "en" = "zh",
  categoryNamesEn: Record<string, string> = {},
  tagNamesEn: Record<string, string> = {},
) => {
  // 文章标签分类生成 keywords
  try {
    const keywords: string[] = [];
    for (const a of articles) {
      const tags = language === "en"
        ? (a.tags || []).map((tag, index) => a.tagsEn?.[index]?.trim() || tagNamesEn[tag] || tag)
        : a.tags || [];
      for (const tag of tags) {
        if (!keywords.includes(tag)) {
          keywords.push(tag);
        }
      }
      const category = language === "en"
        ? a.categoryEn?.trim() || categoryNamesEn[a.category] || a.category
        : a.category;
      if (category && !keywords.includes(category)) {
        keywords.push(category);
      }
    }
    return keywords;
  } catch (err) {
    return [];
  }
};
