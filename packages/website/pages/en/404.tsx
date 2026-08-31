import Custom404 from "../404";

export default function English404() {
  return <Custom404 />;
}

export function getStaticProps() {
  return {
    props: { initialLanguage: "en" as const },
  };
}
