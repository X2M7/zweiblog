import type { GetServerSidePropsContext } from "next";
import PostPages, { PostPagesProps } from "../../post/[id]";
import { getArticleServerSideProps } from "../../../utils/requestPageProps";

export default function EnglishPostPages(props: PostPagesProps) {
  return <PostPages {...props} initialLanguage="en" />;
}

export async function getServerSideProps(context: GetServerSidePropsContext) {
  return getArticleServerSideProps(context, "en");
}
