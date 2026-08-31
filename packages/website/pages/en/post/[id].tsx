import PostPages, {
  getStaticPaths as getPostStaticPaths,
  getStaticProps as getPostStaticProps,
  PostPagesProps,
} from "../../post/[id]";

export default function EnglishPostPages(props: PostPagesProps) {
  return <PostPages {...props} initialLanguage="en" />;
}

export const getStaticPaths = getPostStaticPaths;

export async function getStaticProps(context: any) {
  const result = await getPostStaticProps(context);
  return {
    ...result,
    props: {
      ...result.props,
      initialLanguage: "en",
    },
  };
}
