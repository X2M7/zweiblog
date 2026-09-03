import Link from "next/link";
import React, { CSSProperties } from "react";
import { PageItem } from "./core";
import { useSiteLanguage } from "../../utils/siteLanguage";
const commonCls =
  "inline-flex justify-center items-center transition-all";
const btnCls =
  "bg-white text-gray-600 hover:bg-gray-200 dark:bg-dark-1 dark:pg-text-dark dark:hover:bg-dark-hover dark:hover:pg-text-dark-hover";
const currentBtnCls =
  "bg-[var(--theme-color)] text-white font-semibold shadow-sm hover:brightness-95 dark:bg-dark-hover dark:pg-text-dark-hover dark:shadow-none";
const commonStyle: CSSProperties = {
  height: "28px",
  width: "28px",
  borderRadius: "4px",
  fontSize: "14px",
};
const renderLink = (item: PageItem, isCur: boolean, localizedPath: (href: string) => string) => {
  return (
    <Link
      href={localizedPath(item.href)}
      key={`LinkItem-${item.page}-${item.type}-${item.href}`}
      aria-current={isCur ? "page" : undefined}
    >
      <div
        style={commonStyle}
        className={`${commonCls} ${isCur ? currentBtnCls : btnCls}`}
      >
        {item.page}
      </div>
    </Link>
  );
};
const renderBtn = (item: PageItem, disable: boolean, isNext: boolean, localizedPath: (href: string) => string, label: string) => {
  return (
    <Link
      href={localizedPath(item.href)}
      key={`pagenav-btn-${item.page}-${item.href}-${isNext}`}
    // className="justify-center items-center "
    >
      <div
        aria-label={label}
        style={commonStyle}
        className={`${commonCls} dark:bg-dark-1 dark:pg-text-dark  ${btnCls}`}
      >
        {isNext ? "›" : "‹"}
      </div>
    </Link>
  );
};
const renderMore = (item: PageItem, isNext: boolean, localizedPath: (href: string) => string) => {
  return (
    <Link
      href={localizedPath(item.href)}
      key={`pagenav-more-${item.page}-${item.href}-${isNext}`}
    >
      <div style={commonStyle} className={`dark:pg-text-dark ${commonCls}`}>
        •••
      </div>
    </Link>
  );
};

export const RenderItemList = (props: { items: PageItem[] }) => {
  const { localizedPath, t } = useSiteLanguage();
  const res: React.ReactElement[] = [];
  for (const item of props.items) {
    switch (item.type) {
      case "link":
        res.push(renderLink(item, false, localizedPath));
        break;
      case "link-cur":
        res.push(renderLink(item, true, localizedPath));
        break;
      case "next-btn":
        res.push(renderBtn(item, false, true, localizedPath, t("下一页", "Next page")));
        break;
      case "next-btn-disable":
        res.push(renderBtn(item, true, true, localizedPath, t("下一页", "Next page")));
        break;
      case "next-more":
        res.push(renderMore(item, true, localizedPath));
        break;
      case "pre-more":
        res.push(renderMore(item, false, localizedPath));
        break;
      case "pre-btn":
        res.push(renderBtn(item, false, false, localizedPath, t("上一页", "Previous page")));
        break;
      case "pre-btn-disable":
        res.push(renderBtn(item, true, false, localizedPath, t("上一页", "Previous page")));
        break;
    }
  }
  return <ul className="space-x-2 text-center">{res}</ul>;
};
