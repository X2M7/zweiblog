import type { GetServerSideProps } from "next";
import Custom404 from "./404";
import { getNotFoundLanguage } from "../utils/siteLanguageRouting";

export default Custom404;

/**
 * Next.js discards a middleware response status after an internal rewrite.
 * Render unknown public paths here instead so the first HTML response can be
 * localized while retaining the real HTTP 404 status.
 */
export const getServerSideProps: GetServerSideProps = async ({
  params,
  query,
  res,
}) => {
  res.statusCode = 404;
  return {
    props: {
      initialLanguage: getNotFoundLanguage(query.lang, params?.missing),
    },
  };
};
