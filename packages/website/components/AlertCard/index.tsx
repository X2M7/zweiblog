import Dayjs from "dayjs";
import { useSiteLanguage } from "../../utils/siteLanguage";

// TODO: support expiration time
export default function (props: {
  updatedAt: Date;
  createdAt: Date;
  showExpirationReminder?: boolean;
  expirationDays?: number;
}) {
  const { t } = useSiteLanguage();
  if (props.showExpirationReminder) {
    const dayjs = Dayjs();
    const diff = dayjs.diff(props.createdAt, "days");

    if (diff > (props.expirationDays || 30)) {
      return (
        <div className="warning-card text-gray-600 dark:text-dark">
          <div>
            {t("请注意，本文编写于", "Please note: this article was written")} {diff}{" "}
            {t("天前，最后修改于", "days ago and last updated")} {dayjs.diff(props.updatedAt, "days")}{" "}
            {t("天前，其中某些信息可能已经过时。", "days ago. Some information may now be outdated.")}
          </div>
        </div>
      );
    }
  }

  return null;
}
