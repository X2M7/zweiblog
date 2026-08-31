export const washArticlesByKey = (
  rawArticles: any[],
  getValueFn: (val: any) => any,
  isKeyArray: boolean
) => {
  const articles = {} as any;

  const dates = Array.from(
    new Set(
      isKeyArray
        ? rawArticles.flatMap((a) => getValueFn(a))
        : rawArticles.map((a) => getValueFn(a))
    )
  );

  for (const date of dates) {
    const curArticles = rawArticles
      .filter((each) =>
        isKeyArray ? getValueFn(each).includes(date) : getValueFn(each) == date
      )
      .map((each) =>
        Object.fromEntries(
          Object.entries({
            title: each.title,
            titleEn: each.titleEn,
            hasEnglishVersion: each.hasEnglishVersion,
            id: each.id,
            pathname: each.pathname,
            category: each.category,
            categoryEn: each.categoryEn,
            tags: each.tags,
            tagsEn: each.tagsEn,
            private: each.private,
            createdAt: each.createdAt,
            updatedAt: each.updatedAt,
          }).filter(([, value]) => value !== undefined)
        )
      )
      .sort(
        (prev, next) =>
          new Date(next.createdAt).getTime() -
          new Date(prev.createdAt).getTime()
      );

    articles[String(date)] = curArticles;
  }

  return articles;
};
