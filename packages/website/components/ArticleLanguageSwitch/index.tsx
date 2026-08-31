import React from "react";
import type { ArticleLanguage } from "../../utils/articleLanguage";

export default function ArticleLanguageSwitch({
  language,
  onChange,
}: {
  language: ArticleLanguage;
  onChange: (language: ArticleLanguage) => void;
}) {
  return (
    <div
      aria-label="文章语言 / Article language"
      className="mx-auto mb-4 flex w-fit rounded-full border border-slate-200 bg-slate-50 p-1 text-xs shadow-sm dark:border-gray-700 dark:bg-dark-2"
      role="group"
    >
      {(["zh", "en"] as const).map((item) => {
        const active = language === item;
        const label = item === "zh" ? "中文" : "English";
        return (
          <button
            aria-pressed={active}
            className={`min-w-[76px] rounded-full px-3 py-1.5 font-medium transition-colors ${
              active
                ? "bg-sky-600 text-white shadow"
                : "text-gray-500 hover:text-sky-600 dark:text-gray-300 dark:hover:text-sky-300"
            }`}
            key={item}
            lang={item === "zh" ? "zh-CN" : "en"}
            onClick={() => onChange(item)}
            type="button"
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
