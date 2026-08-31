import Image from "next/image";
import Head from "next/head";
import Link from "next/link";
import { useSiteLanguage } from "../utils/siteLanguage";

const ENGLISH_NAMES: Record<string, string> = {
  文章: "Article",
  标签: "Tag",
  页码: "Page",
};

export default function (props: { name?: string; nameEn?: string }) {
  const { localizedPath, t } = useSiteLanguage();
  const englishName = props.nameEn || (props.name ? ENGLISH_NAMES[props.name] : "");
  const missing = props.name
    ? t(`此${props.name}不存在`, `${englishName || props.name} was not found`)
    : t("此页面不存在", "Page not found");
  return (
    <>
      <Head>
        <title>{missing}</title>
        <link rel="icon" href={"/logo.svg"}></link>
      </Head>
      <div
        className="flex items-center justify-center"
        style={{ top: 0, left: 0, bottom: 0, right: 0, position: "absolute" }}
      >
        <div
          className="flex flex-col items-center justify-center select-none"
          style={{ transform: "translateY(-30%)" }}
        >
          <Image alt="logo" src="/logo.svg" width={200} height={200} />
          <div className="mt-4 text-gray-600 font-base text-xl dark:text-dark">
            {missing}
          </div>
          <Link href={localizedPath("/")}>
            <div className="mt-4 ua ua-link text-base text-gray-600 dark:text-dark">
              {t("返回主页", "Back to home")}
            </div>
          </Link>
        </div>
      </div>
    </>
  );
}
