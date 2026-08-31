import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import CopyToClipboard from "react-copy-to-clipboard";
import toast from "react-hot-toast";
import {
  type Language,
  useSiteLanguage,
} from "../../utils/siteLanguage";

type ShareableLocation = Pick<
  Location,
  "protocol" | "host" | "pathname" | "search" | "hash"
>;

export function getShareablePageUrl(location: ShareableLocation): string {
  return `${location.protocol}//${location.host}${location.pathname}${location.search}${location.hash}`;
}

export function getCopyrightText(
  language: Language,
  copyrightAggreement: string,
  customCopyRight?: string | null,
  customCopyRightEn?: string | null,
): string {
  const localizedCustomText =
    language === "en" ? customCopyRightEn?.trim() : customCopyRight?.trim();
  if (localizedCustomText) return localizedCustomText;

  return language === "en"
    ? `Unless otherwise stated, all articles on this blog are licensed under the ${copyrightAggreement} license. Please credit the source when sharing.`
    : `本博客所有文章除特别声明外，均采用 ${copyrightAggreement}
    许可协议。转载请注明出处！`;
}

function getReadablePageUrl(url: string): string {
  try {
    return decodeURI(url);
  } catch {
    return url;
  }
}

export default function (props: {
  author: string;
  id: number | string;
  showDonate: boolean;
  copyrightAggreement: string;
  customCopyRight: string | null;
  customCopyRightEn?: string | null;
}) {
  const [url, setUrl] = useState("");
  const router = useRouter();
  const { language, t } = useSiteLanguage();
  useEffect(() => {
    const updateUrl = () => setUrl(getShareablePageUrl(window.location));
    updateUrl();
    window.addEventListener("hashchange", updateUrl);
    return () => window.removeEventListener("hashchange", updateUrl);
  }, [router.asPath]);

  const text = useMemo(() => {
    return getCopyrightText(
      language,
      props.copyrightAggreement,
      props.customCopyRight,
      props.customCopyRightEn,
    );
  }, [
    language,
    props.customCopyRight,
    props.customCopyRightEn,
    props.copyrightAggreement,
  ]);
  const readableUrl = useMemo(() => getReadablePageUrl(url), [url]);

  return (
    <div
      className={`bg-gray-100 px-5 border-l-4 border-red-500  py-2 text-sm space-y-1 dark:text-dark  dark:bg-dark ${
        !props.showDonate ? "mt-8" : ""
      }`}
    >
      <p>
        <span className="mr-2">{t("本文作者", "Author")}:</span>
        <span>{props.author}</span>
      </p>
      <p>
        <span className="mr-2">{t("本文链接", "Article URL")}:</span>
        <CopyToClipboard
          text={url}
          onCopy={() => {
            toast.success(t("复制成功！", "Copied."), {
              className: "toast",
            });
          }}
        >
          <span
            className="cursor-pointer border-b border-gray-100 hover:border-gray-500 dark:text-dark dark-border-hover dark:border-nav-dark"
            style={{ wordBreak: "break-all" }}
          >
            {readableUrl}
          </span>
        </CopyToClipboard>
      </p>
      <p>
        <span className="mr-2">{t("版权声明", "Copyright")}:</span>
        <span>{text}</span>
      </p>
    </div>
  );
}
