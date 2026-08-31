import CategoryPage, {
  CategoryPageProps,
  getStaticProps as getCategoryStaticProps,
} from "../../category";

export default function EnglishCategoryPage(props: CategoryPageProps) {
  return <CategoryPage {...props} />;
}

export async function getStaticProps() {
  const result = await getCategoryStaticProps();
  return {
    ...result,
    props: { ...result.props, initialLanguage: "en" as const },
  };
}
