import { Article } from "../../types/article";
import { useState } from "react";
import ArticleList from "../ArticleList";
import { useSiteLanguage } from "../../utils/siteLanguage";

export default function (props: {
  date: string;
  dateEn?: string;
  articles: Article[];
  defaultOpen?: boolean;
  showYear?: boolean;
  openArticleLinksInNewWindow: boolean;
}) {
  const [visible, setVisible] = useState(Boolean(props.defaultOpen));
  const { language, t } = useSiteLanguage();
  const calMaxHeight = props.articles.length * 50;
  return (
    <div className="mb-4 overflow-hidden">
      <div className="flex items-center mb-4 z-50 ">
        <div className="text-xl md:text-2xl font-bold dark:text-dark">
          {language === "en" && props.dateEn?.trim() ? props.dateEn : props.date}
        </div>

        <div className="ml-2 text-sm md:text-base text-gray-400 font-normal dark:text-dark-400">
          {props.articles.length}{t("篇", " articles")}
        </div>
        <div
          onClick={() => {
            setVisible(!visible);
          }}
          aria-label={visible ? t("折叠文章列表", "Collapse article list") : t("展开文章列表", "Expand article list")}
          style={{ width: 22.5 }}
          className="dark:text-dark-light dark:hover:bg-dark-light dark:hover:text-dark-r dark:bg-dark-1 inline-block text-center leading-tight  font-normal text-lg bg-gray-200 rounded ml-2 cursor-pointer hover:bg-gray-500 hover:text-gray-100 transition-all"
        >
          +
        </div>
      </div>
      <div
        className="transition-all z-0 "
        style={{ maxHeight: visible ? `${calMaxHeight}px` : "0" }}
      >
        <ArticleList
          articles={props.articles}
          showYear={props.showYear}
          openArticleLinksInNewWindow={props.openArticleLinksInNewWindow}
        ></ArticleList>
      </div>
    </div>
  );
}
