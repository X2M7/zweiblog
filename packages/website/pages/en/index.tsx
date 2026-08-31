import Home, {
  getStaticProps as getHomeStaticProps,
  IndexPageProps,
} from "../index";

export default function EnglishHome(props: IndexPageProps) {
  return <Home {...props} />;
}

export async function getStaticProps() {
  const result = await getHomeStaticProps();
  return {
    ...result,
    props: { ...result.props, initialLanguage: "en" as const },
  };
}
