import TimeLine, {
  getStaticProps as getTimelineStaticProps,
  TimeLinePageProps,
} from "../timeline";

export default function EnglishTimeline(props: TimeLinePageProps) {
  return <TimeLine {...props} />;
}

export async function getStaticProps() {
  const result = await getTimelineStaticProps();
  return {
    ...result,
    props: { ...result.props, initialLanguage: "en" as const },
  };
}
