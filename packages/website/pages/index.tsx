import AuthorCard, { AuthorCardProps } from "../components/AuthorCard";
import Layout from "../components/Layout";
import PageNav from "../components/PageNav";
import PostCard from "../components/PostCard";
import { Article } from "../types/article";
import { LayoutProps } from "../utils/getLayoutProps";
import { getIndexPageProps } from "../utils/getPageProps";
import { revalidate } from "../utils/loadConfig";
import Comments from "../components/Comments";
import Head from "next/head";
import { getArticlesKeyWord } from "../utils/keywords";
import { getArticlePath } from "../utils/getArticlePath";
import { hasEnglishArticle, localizeArticle } from "../utils/articleLanguage";
import { useSiteLanguage } from "../utils/siteLanguage";
export interface IndexPageProps {
  layoutProps: LayoutProps;
  authorCardProps: AuthorCardProps;
  currPage: number;
  articles: Article[];
}
const Home = (props: IndexPageProps) => {
  const { language } = useSiteLanguage();
  const siteName = language === "en" && props.layoutProps.siteNameEn?.trim()
    ? props.layoutProps.siteNameEn
    : props.layoutProps.siteName;
  return (
    <Layout
      option={props.layoutProps}
      title={siteName}
      sideBar={<AuthorCard option={props.authorCardProps}></AuthorCard>}
    >
      <Head>
        <meta
          name="keywords"
          content={getArticlesKeyWord(
            props.articles,
            language,
            props.layoutProps.categoryNamesEn,
            props.layoutProps.tagNamesEn,
          ).join(",")}
        ></meta>
      </Head>
      <div className="space-y-2 md:space-y-4">
        {props.articles.map((article) => {
          const localized = localizeArticle(article, language);
          return (
          <PostCard
            showEditButton={props.layoutProps.showEditButton === "true"}
            setContent={() => {}}
            showExpirationReminder={
              props.layoutProps.showExpirationReminder == "true"
            }
            openArticleLinksInNewWindow={
              props.layoutProps.openArticleLinksInNewWindow == "true"
            }
            customCopyRight={null}
            private={article.private}
            top={article.top || 0}
            id={getArticlePath(article)}
            key={article.id}
            title={localized.title}
            updatedAt={new Date(article.updatedAt)}
            createdAt={new Date(article.createdAt)}
            catelog={article.category}
            catelogEn={article.categoryEn || props.layoutProps.categoryNamesEn[article.category]}
            content={localized.content || ""}
            language={language === "en" && hasEnglishArticle(article) ? "en" : "zh"}
            type={"overview"}
            enableComment={props.layoutProps.enableComment}
            copyrightAggreement={props.layoutProps.copyrightAggreement}
          ></PostCard>
          );
        })}
      </div>
      <PageNav
        total={props.authorCardProps.postNum}
        current={props.currPage}
        base={"/"}
        more={"/page"}
      ></PageNav>
      <Comments enable={props.layoutProps.enableComment} visible={false} />
    </Layout>
  );
};

export default Home;
export async function getStaticProps(): Promise<{
  props: IndexPageProps;
  revalidate?: number;
}> {
  return {
    props: await getIndexPageProps(),
    ...revalidate,
  };
}
