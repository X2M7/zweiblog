import AboutPage, {
  AboutPageProps,
  getStaticProps as getAboutStaticProps,
} from "../about";

export default function EnglishAboutPage(props: AboutPageProps) {
  return <AboutPage {...props} />;
}

export async function getStaticProps() {
  const result = await getAboutStaticProps();
  return {
    ...result,
    props: { ...result.props, initialLanguage: "en" as const },
  };
}
