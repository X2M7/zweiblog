import dayjs from "dayjs";
import Link from "next/link";
import React from "react";

import { getTarget } from "../Link/tools";
import { type Article } from "../../types/article";
import { getArticlePath } from "../../utils/getArticlePath";
import {
  hasEnglishArticle,
  localizeArticle,
} from "../../utils/articleLanguage";
import { useSiteLanguage } from "../../utils/siteLanguage";

export default function ArticleList(props: {
  articles: Article[];
  showYear?: boolean;
  openArticleLinksInNewWindow: boolean;
  onClick?: () => void;
}) {
  const { language, localizedPath } = useSiteLanguage();
  return (
  <div className="space-y-2" onClick={props.onClick}>
    {props.articles.map((article) => {
      const localized = localizeArticle(article, language);
      return (
      <Link
        href={localizedPath(`/post/${getArticlePath(article)}`)}
        key={article.id}
        target={getTarget(props.openArticleLinksInNewWindow)}
      >
        <div className="dark:border-dark-2 dark:hover:border-nav-dark-light flex items-center border-b pb-1 border-dashed cursor-pointer group border-gray-200 hover:border-gray-400 ">
          <div className="text-gray-400 flex-grow-0 flex-shrink-0 text-sm  group-hover:text-gray-600 dark:text-dark-400 dark:group-hover:text-dark-light">
            {dayjs(article.createdAt).format(
              props.showYear ? "YYYY-MM-DD" : "MM-DD"
            )}
          </div>
          <div
            className="ml-2 md:ml-4 text-base flex-grow flex-shrink overflow-hidden text-gray-600 group-hover:text-gray-800 dark:text-dark dark:group-hover:text-dark"
            lang={language === "en" && hasEnglishArticle(article) ? "en" : "zh-CN"}
          >
            {localized.title}
          </div>
        </div>
      </Link>
      );
    })}
  </div>
  );
}
