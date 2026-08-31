import PagePages, {
  getStaticPaths as getPageStaticPaths,
  getStaticProps as getPageStaticProps,
  PagePagesProps,
} from "../../page/[p]";

export default function EnglishPagePages(props: PagePagesProps) {
  return <PagePages {...props} />;
}

export const getStaticPaths = getPageStaticPaths;

export async function getStaticProps(context: any) {
  const result = await getPageStaticProps(context);
  return {
    ...result,
    props: { ...result.props, initialLanguage: "en" as const },
  };
}
