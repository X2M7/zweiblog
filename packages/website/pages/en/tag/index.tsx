import TagPage, {
  getStaticProps as getTagStaticProps,
  TagPageProps,
} from "../../tag";

export default function EnglishTagPage(props: TagPageProps) {
  return <TagPage {...props} />;
}

export async function getStaticProps() {
  const result = await getTagStaticProps();
  return {
    ...result,
    props: { ...result.props, initialLanguage: "en" as const },
  };
}
