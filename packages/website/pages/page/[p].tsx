import Head from "next/head";
import { getPublicMeta } from "../../api/getAllData";
import AuthorCard, { AuthorCardProps } from "../../components/AuthorCard";
import Layout from "../../components/Layout";
import PageNav from "../../components/PageNav";
import PostCard from "../../components/PostCard";
import Comments from "../../components/Comments";
import { Article } from "../../types/article";
import { getArticlePath } from "../../utils/getArticlePath";
import { LayoutProps } from "../../utils/getLayoutProps";
import { getPagePagesProps } from "../../utils/getPageProps";
import { getArticlesKeyWord } from "../../utils/keywords";
import { revalidate } from "../../utils/loadConfig";
import Custom404 from "../404";
import { hasEnglishArticle, localizeArticle } from "../../utils/articleLanguage";
import { useSiteLanguage } from "../../utils/siteLanguage";
export interface PagePagesProps {
  layoutProps: LayoutProps;
  authorCardProps: AuthorCardProps;
  currPage: number;
  articles: Article[];
}
const PagePages = (props: PagePagesProps) => {
  const { language } = useSiteLanguage();
  if (props.articles.length == 0) {
    return <Custom404 name="页码" />;
  }
  return (
    <Layout
      option={props.layoutProps}
      title={language === "en" && props.layoutProps.siteNameEn?.trim()
        ? props.layoutProps.siteNameEn
        : props.layoutProps.siteName}
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
            copyrightAggreement={props.layoutProps.copyrightAggreement}
            openArticleLinksInNewWindow={
              props.layoutProps.openArticleLinksInNewWindow == "true"
            }
            customCopyRight={null}
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
            private={article.private}
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

export default PagePages;

export async function getStaticPaths() {
  const data = await getPublicMeta();
  const total = Math.ceil(data.totalArticles / 5);
  const paths = [];
  for (let i = 1; i <= total; i++) {
    paths.push({
      params: {
        p: String(i),
      },
    });
  }
  return {
    paths,
    fallback: "blocking",
  };
}

export async function getStaticProps({
  params,
}: any): Promise<{ props: PagePagesProps; revalidate?: number }> {
  return {
    props: await getPagePagesProps(params.p),
    ...revalidate,
  };
}
