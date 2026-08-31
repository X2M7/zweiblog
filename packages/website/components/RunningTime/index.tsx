import { useEffect, useMemo, useRef, useState } from "react";
import dayjs from "dayjs";
import { useSiteLanguage } from "../../utils/siteLanguage";
export default function (props: { since: string }) {
  const [elapsed, setElapsed] = useState("");
  const { current } = useRef<any>({ timer: null });
  const since = useMemo(() => dayjs(props.since), [props.since]);
  const { language, t } = useSiteLanguage();
  useEffect(() => {
    current.timer = setInterval(() => {
      const now = dayjs();
      const days = now.diff(since, "days");
      const hours = now.diff(since, "hours") - days * 24;
      const mins = now.diff(since, "minutes") - days * 24 * 60 - hours * 60;
      const secs =
        now.diff(since, "seconds") -
        days * 24 * 60 * 60 -
        hours * 60 * 60 -
        mins * 60;
      const s = language === "en"
        ? `${days}d ${hours}h ${mins}m ${secs}s`
        : `${days}天${hours}小时${mins}分${secs}秒`;
      setElapsed(s);
    }, 1000);
    return () => {
      clearInterval(current.timer);
    };
  }, [language, since]);
  return (
    <p>
      <span>{t("本站居然运行了", "This site has been running for ")}</span>
      <span>{elapsed}</span>
    </p>
  );
}
