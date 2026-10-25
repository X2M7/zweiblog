import CategoryPages, {
  CategoryPagesProps,
  getServerSideProps as getCategoryServerSideProps,
} from "../../category/[category]";

export default function EnglishCategoryPages(props: CategoryPagesProps) {
  return <CategoryPages {...props} />;
}

export async function getServerSideProps(context: any) {
  const result = await getCategoryServerSideProps(context);
  return {
    ...result,
    props: { ...result.props, initialLanguage: "en" as const },
  };
}
