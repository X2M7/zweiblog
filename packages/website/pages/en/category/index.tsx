import CategoryPage, {
  CategoryPageProps,
  getServerSideProps as getCategoryServerSideProps,
} from "../../category";

export default function EnglishCategoryPage(props: CategoryPageProps) {
  return <CategoryPage {...props} />;
}

export async function getServerSideProps(context: any) {
  const result = await getCategoryServerSideProps(context);
  return {
    ...result,
    props: { ...result.props, initialLanguage: "en" as const },
  };
}
