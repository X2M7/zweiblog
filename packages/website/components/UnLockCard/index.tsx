import { useState } from "react";
import { getArticleByIdOrPathnameWithPassword } from "../../api/getArticles";
import toast from "react-hot-toast";
import Loading from "../Loading";
import type { Article } from "../../types/article";
import { useSiteLanguage } from "../../utils/siteLanguage";

export default function (props: {
  id: number | string;
  setLock: (l: boolean) => void;
  setContent: (s: string) => void;
  language?: "zh" | "en";
  onUnlock?: (article: Article) => void;
}) {
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const { t } = useSiteLanguage();

  const onSuccess = (message: string) => {
    toast.success(message, {
      className: "toast",
    });
  };
  const onError = (message: string) => {
    toast.error(message, {
      className: "toast",
    });
  };
  const fetchArticle = async () => {
    try {
      const res = await getArticleByIdOrPathnameWithPassword(props.id, value);
      if (!res) {
        onError(t("密码错误！请重试！", "Incorrect password. Please try again."));
        return false;
      }
      return res;
    } catch (err) {
      onError(t("密码错误！请重试！", "Incorrect password. Please try again."));
      return false;
    }
  };
  const handleClick = async () => {
    if (value == "") {
      onError(t("输入不能为空！", "Password cannot be empty."));
      return;
    }
    setLoading(true);
    try {
      const article = await fetchArticle();
      if (article) {
        setLoading(false);
        onSuccess(t("解锁成功！", "Unlocked successfully."));
        if (props.onUnlock) props.onUnlock(article);
        else {
          props.setContent(
            props.language === "en" && article.contentEn
              ? article.contentEn
              : article.content,
          );
        }
        props.setLock(false);
      } else {
        setLoading(false);
      }
    } catch (err) {
      onError(t("解锁失败！", "Unable to unlock this article."));
      setLoading(false);
    }
  };
  return (
    <>
      <Loading loading={loading}>
        <div className="mb-2">
          <p className="mb-2 text-gray-600 dark:text-dark ">
            {t("文章已加密，请输入密码后查看：", "This article is protected. Enter the password to continue:")}
          </p>
          <div className="flex items-center">
            <div className=" bg-gray-100 rounded-md dark:bg-dark-2 overflow-hidden flex-grow">
              <input
                type="password"
                value={value}
                onChange={(ev) => {
                  setValue(ev.currentTarget.value);
                }}
                aria-label={t("文章密码", "Article password")}
                placeholder={t("请输入密码", "Enter password")}
                className="ml-2 w-full text-base dark:text-dark "
                style={{
                  height: 32,
                  appearance: "none",
                  border: "none",
                  outline: "medium",
                  backgroundColor: "inherit",
                }}
              ></input>
            </div>
            <button
              onClick={handleClick}
              className="flex-grow-0 text-gray-500 dark:text-dark ml-2 rounded-md dark:bg-dark-2 bg-gray-200 transition-all hover:text-lg  w-20 h-8"
            >
              {t("确认", "Unlock")}
            </button>
          </div>
        </div>
      </Loading>
    </>
  );
}
