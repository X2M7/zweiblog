import ImageBox from "../ImageBox";
import RunningTime from "../RunningTime";
import Viewer from "../Viewer";
import { useSiteLanguage } from "../../utils/siteLanguage";

export default function ({
  ipcHref,
  ipcNumber,
  since,
  version,
  gaBeianLogoUrl,
  gaBeianNumber,
  gaBeianUrl,
}: {
  // 公安备案
  gaBeianNumber: string;
  gaBeianUrl: string;
  gaBeianLogoUrl: string;
  // ipc
  ipcNumber: string;
  ipcHref: string;
  since: string;
  version: string;
}) {
  const { t } = useSiteLanguage();
  return (
    <>
      <footer className="text-center text-sm space-y-1 mt-8 md:mt-12 dark:text-dark footer-icp-number">
        {Boolean(ipcNumber) && (
          <p className="">
            {t("ICP 编号", "ICP registration")}:&nbsp;
            <a
              href={ipcHref}
              target="_blank"
              className="hover:text-gray-900 hover:underline-offset-2 hover:underline dark:hover:text-dark-hover transition"
            >
              {ipcNumber}
            </a>
          </p>
        )}
        {Boolean(gaBeianNumber) && (
          <p className="flex justify-center items-center footer-gongan-beian">
            {t("公安备案", "Public security registration")}:&nbsp;
            {Boolean(gaBeianLogoUrl) && (
              <ImageBox
                src={gaBeianLogoUrl}
                lazyLoad={true}
                alt={t("公安备案 logo", "Public security registration logo")}
                width={20}
              />
            )}
            <a
              href={gaBeianUrl}
              target="_blank"
              className="hover:text-gray-900 hover:underline-offset-2 hover:underline dark:hover:text-dark-hover transition"
            >
              {gaBeianNumber}
            </a>
          </p>
        )}
        <RunningTime since={since}></RunningTime>
        <p className="footer-powered-by-zweiblog">
          Powered By&nbsp;
          <a
            href="https://github.com/X2M7/zweiblog"
            target={"_blank"}
            className="hover:text-gray-900 dark:hover:text-dark-hover transition ua ua-link"
          >
            ZweiBlog <span>{version}</span>
          </a>
        </p>

        <p className="select-none footer-copy-right">
          © {new Date(since).getFullYear()} - {new Date().getFullYear()}
        </p>
        <p className="select-none footer-viewer">
          <Viewer></Viewer>
        </p>
      </footer>
    </>
  );
}
