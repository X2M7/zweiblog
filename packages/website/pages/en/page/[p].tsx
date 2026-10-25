import PagePages, {
  getServerSideProps as getPageServerSideProps,
  PagePagesProps,
} from "../../page/[p]";

export default function EnglishPagePages(props: PagePagesProps) {
  return <PagePages {...props} />;
}

export async function getServerSideProps(context: any) {
  const result = await getPageServerSideProps(context);
  return {
    ...result,
    props: { ...result.props, initialLanguage: "en" as const },
  };
}
