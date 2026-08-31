import { useState, useEffect } from "react";
import CopyToClipboard from "react-copy-to-clipboard";
import toast from "react-hot-toast";
import RssLogo from "../RssLogo";
import { useSiteLanguage } from "../../utils/siteLanguage";

export default function (props: { showAdminButton: boolean }) {
  const [url, setUrl] = useState("");
  const { t } = useSiteLanguage();
  useEffect(() => {
    setUrl(`${location.protocol}//${location.host}/feed.xml`);
  }, [setUrl]);
  return (
    <div
      aria-label={t("RSS 订阅", "RSS feed")}
      title={t("RSS 订阅", "RSS feed")}
      className={`flex items-center  justify-center cursor-pointer hover:scale-125 transform transition-all ${
        props.showAdminButton ? "mr-4 md:mr-6 lg:mr-2 " : "mr-4 md:mr-4 lg:mr-4"
      }`}
    >
      <CopyToClipboard
        text={url}
        onCopy={() => {
          toast.success(t("已复制 RSS 订阅地址到剪切板！", "RSS feed URL copied to the clipboard."), {
            className: "toast",
          });
        }}
      >
        <div className="dark:text-dark text-gray-600">
          <RssLogo size={20} />
        </div>
      </CopyToClipboard>
    </div>
  );
}
