import { useEffect, useState } from "react";
import { isMac } from "../../utils/ua";
import { useSiteLanguage } from "../../utils/siteLanguage";

export default function (props: { type: "search" | "esc" }) {
  const [keyString, setKeyString] = useState("Ctrl");
  const { t } = useSiteLanguage();
  useEffect(() => {
    if (isMac()) {
      setKeyString("⌘");
    }
  }, [])
  if (props.type == "search") {
    return (
      <div className="flex items-center">
        <span
          style={{ opacity: 1, height: 24 }}
          className="hidden sm:flex items-center  text-gray-500 text-sm leading-5 py-0.5 px-1.5 border border-gray-300 rounded-md dark:text-dark dark:border-dark"
        >
          <span className="sr-only">{t("按 ", "Press ")}</span>
          <kbd className="font-sans ">
            <abbr className="no-underline ">{keyString}</abbr>
          </kbd>
          <span className="mx-1">+</span>
          <span className="sr-only">{t(" 和 ", " and ")}</span>
          <kbd className="font-sans ">K</kbd>
          <span className="sr-only">{t(" 进行搜索", " to search")}</span>
        </span>
      </div>
    );
  } else {
    return (
      <div className="flex items-center select-none ml-2">
        <span
          style={{ opacity: 1, height: 24, lineHeight: "17.73px" }}
          className="hidden sm:block text-gray-500 text-sm leading-5 py-0.5 px-1.5 border border-gray-300 rounded-md dark:text-dark dark:border-dark"
        >
          <span className="sr-only">{t("按 ", "Press ")}</span>
          <kbd className="font-sans">esc</kbd>
          <span className="sr-only">{t(" 关闭", " to close")}</span>
        </span>
      </div>
    );
  }
}
