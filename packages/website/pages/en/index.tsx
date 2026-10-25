import Home, {
  getServerSideProps as getHomeServerSideProps,
  IndexPageProps,
} from "../index";

export default function EnglishHome(props: IndexPageProps) {
  return <Home {...props} />;
}

export async function getServerSideProps(context: any) {
  const result = await getHomeServerSideProps(context);
  return {
    ...result,
    props: { ...result.props, initialLanguage: "en" as const },
  };
}
