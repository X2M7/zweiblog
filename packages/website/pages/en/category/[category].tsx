import CategoryPages, {
  CategoryPagesProps,
  getStaticPaths as getCategoryStaticPaths,
  getStaticProps as getCategoryStaticProps,
} from "../../category/[category]";

export default function EnglishCategoryPages(props: CategoryPagesProps) {
  return <CategoryPages {...props} />;
}

export const getStaticPaths = getCategoryStaticPaths;

export async function getStaticProps(context: any) {
  const result = await getCategoryStaticProps(context);
  return {
    ...result,
    props: { ...result.props, initialLanguage: "en" as const },
  };
}
