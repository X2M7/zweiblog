import TagPages, {
  getServerSideProps as getTagServerSideProps,
  TagPagesProps,
} from "../../tag/[tag]";

export default function EnglishTagPages(props: TagPagesProps) {
  return <TagPages {...props} />;
}

export async function getServerSideProps(context: any) {
  const result = await getTagServerSideProps(context);
  return {
    ...result,
    props: { ...result.props, initialLanguage: "en" as const },
  };
}
