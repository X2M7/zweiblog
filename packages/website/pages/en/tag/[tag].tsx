import TagPages, {
  getStaticPaths as getTagStaticPaths,
  getStaticProps as getTagStaticProps,
  TagPagesProps,
} from "../../tag/[tag]";

export default function EnglishTagPages(props: TagPagesProps) {
  return <TagPages {...props} />;
}

export const getStaticPaths = getTagStaticPaths;

export async function getStaticProps(context: any) {
  const result = await getTagStaticProps(context);
  return {
    ...result,
    props: { ...result.props, initialLanguage: "en" as const },
  };
}
