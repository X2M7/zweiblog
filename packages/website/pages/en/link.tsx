import LinkPage, {
  getStaticProps as getLinkStaticProps,
  LinkPageProps,
} from "../link";

export default function EnglishLinkPage(props: LinkPageProps) {
  return <LinkPage {...props} />;
}

export async function getStaticProps() {
  const result = await getLinkStaticProps();
  return {
    ...result,
    props: { ...result.props, initialLanguage: "en" as const },
  };
}
