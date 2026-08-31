import Head from "next/head";
import { useEffect, useState } from "react";
import { getArticlesByOption } from "../../api/getArticles";
import Layout from "../../components/Layout";
import PostCard from "../../components/PostCard";
import Toc from "../../components/Toc";
import { Article } from "../../types/article";
import {
  ArticleLanguage,
  getArticleLanguageMetadata,
  hasEnglishArticle,
  localizeArticle,
  markdownSummary,
  resolveArticleLocalizedFields,
  resolveEffectiveArticleLanguage,
} from "../../utils/articleLanguage";
import { getArticlePath } from "../../utils/getArticlePath";
import { LayoutProps } from "../../utils/getLayoutProps";
import { getPostPagesProps } from "../../utils/getPageProps";
import { hasToc } from "../../utils/hasToc";
import { getArticlesKeyWord } from "../../utils/keywords";
import { revalidate } from "../../utils/loadConfig";
import Custom404 from "../404";
import { useSiteLanguage } from "../../utils/siteLanguage";

export interface NeighborArticle {
  id: number;
  title: string;
  titleEn?: string;
  hasEnglishVersion?: boolean;
  pathname?: string;
}

export interface PostPagesProps {
  layoutProps: LayoutProps;
  article: Article;
  pay: string[];
  payDark: string[];
  author: string;
  authorEn?: string;
  pre?: NeighborArticle;
  next?: NeighborArticle;
  showSubMenu: "true" | "false";
  initialLanguage?: ArticleLanguage;
}

const PostPages = (props: PostPagesProps) => {
  const { language } = useSiteLanguage();
  const articleId = props?.article?.id;
  const articlePath = props.article ? `/post/${getArticlePath(props.article)}` : "";
  const [localizedState, setLocalizedState] = useState(() => ({
    articleId,
    content: props?.article?.content || "",
    contentEn: props?.article?.contentEn || "",
    summary: props?.article?.summary || "",
    summaryEn: props?.article?.summaryEn || "",
  }));
  // Next may reuse this page while moving between articles. Never combine
  // the next article's metadata with the previous (possibly unlocked) body
  // during the render before effects run.
  const localizedFields = props.article
    ? resolveArticleLocalizedFields(props.article, localizedState)
    : { content: "", contentEn: "", summary: "", summaryEn: "" };

  const articleWithUnlockedContent = props?.article
    ? { ...props.article, ...localizedFields }
    : null;
  const englishAvailable = hasEnglishArticle(articleWithUnlockedContent);
  const articleLanguage = resolveEffectiveArticleLanguage(
    language,
    englishAvailable,
  );
  const localized = articleWithUnlockedContent
    ? localizeArticle(articleWithUnlockedContent, articleLanguage)
    : { title: "", content: "", summary: "" };
  const content = localized.content;

  useEffect(() => {
    setLocalizedState({
      articleId,
      content: props?.article?.content || "",
      contentEn: props?.article?.contentEn || "",
      summary: props?.article?.summary || "",
      summaryEn: props?.article?.summaryEn || "",
    });
  }, [articleId, props.article]);

  if (!props.article) {
    return <Custom404 name="文章" />;
  }

  const description = localized.summary || markdownSummary(content);
  const languageMetadata = getArticleLanguageMetadata(
    articlePath,
    articleLanguage,
  );
  const localizeNeighbor = (neighbor?: NeighborArticle) =>
    neighbor
      ? {
          ...neighbor,
          title:
            language === "en" &&
            neighbor.hasEnglishVersion &&
            neighbor.titleEn?.trim()
              ? neighbor.titleEn
              : neighbor.title,
        }
      : undefined;

  return (
    <Layout
      option={props.layoutProps}
      title={localized.title}
      sideBar={
        hasToc(content) ? (
          <Toc content={content} showSubMenu={props.showSubMenu} />
        ) : null
      }
    >
      <Head>
        <meta key="description" name="description" content={description} />
        <meta
          name="keywords"
          content={getArticlesKeyWord(
            [props.article],
            language,
            props.layoutProps.categoryNamesEn,
            props.layoutProps.tagNamesEn,
          ).join(",")}
        />
        <link href={articlePath} hrefLang="zh-CN" rel="alternate" />
        <link href={articlePath} hrefLang="x-default" rel="alternate" />
        {englishAvailable && (
          <link href={`${articlePath}?lang=en`} hrefLang="en" rel="alternate" />
        )}
        <link
          href={languageMetadata.canonicalHref}
          rel="canonical"
        />
        <meta
          content={languageMetadata.openGraphLocale}
          property="og:locale"
        />
      </Head>
      <PostCard
        showEditButton={props.layoutProps.showEditButton === "true"}
        showExpirationReminder={
          props.layoutProps.showExpirationReminder == "true"
        }
        copyrightAggreement={props.layoutProps.copyrightAggreement}
        openArticleLinksInNewWindow={
          props.layoutProps.openArticleLinksInNewWindow == "true"
        }
        customCopyRight={props.article.copyright || null}
        customCopyRightEn={props.article.copyrightEn || null}
        top={props.article.top || 0}
        id={getArticlePath(props.article)}
        key={props.article.id}
        title={localized.title}
        updatedAt={new Date(props.article.updatedAt)}
        createdAt={new Date(props.article.createdAt)}
        catelog={props.article.category}
        catelogEn={props.article.categoryEn || props.layoutProps.categoryNamesEn[props.article.category]}
        content={content}
        setContent={(nextContent) => {
          setLocalizedState({
            articleId,
            content:
              articleLanguage === "zh"
                ? nextContent
                : localizedFields.content,
            contentEn:
              articleLanguage === "en"
                ? nextContent
                : localizedFields.contentEn,
            summary: localizedFields.summary,
            summaryEn: localizedFields.summaryEn,
          });
        }}
        type="article"
        pay={props.pay}
        payDark={props.payDark}
        private={props.article.private}
        author={language === "en" && props.authorEn?.trim() ? props.authorEn : props.author}
        tags={props.article.tags}
        tagsEn={props.article.tagsEn || props.article.tags.map((tag) => props.layoutProps.tagNamesEn[tag] || "")}
        pre={localizeNeighbor(props.pre)}
        next={localizeNeighbor(props.next)}
        language={articleLanguage}
        onUnlock={(article) => {
          setLocalizedState({
            articleId,
            content: article.content || "",
            contentEn: article.contentEn || "",
            summary: article.summary || "",
            summaryEn: article.summaryEn || "",
          });
        }}
        enableComment={props.layoutProps.enableComment}
        hideDonate={props.layoutProps.showDonateButton == "false"}
        hideCopyRight={props.layoutProps.showCopyRight == "false"}
      />
    </Layout>
  );
};

export default PostPages;

export async function getStaticPaths() {
  const data = await getArticlesByOption({
    page: 1,
    pageSize: -1,
    toListView: true,
  });
  const paths = data.articles.map((article) => ({
    params: {
      id: String(getArticlePath(article)),
    },
  }));
  return {
    paths,
    fallback: "blocking",
  };
}

export async function getStaticProps({
  params,
}: any): Promise<{ props: PostPagesProps; revalidate?: number }> {
  return {
    props: await getPostPagesProps(params.id),
    ...revalidate,
  };
}
