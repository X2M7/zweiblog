import TimeLine, {
  getServerSideProps as getTimelineServerSideProps,
  TimeLinePageProps,
} from "../timeline";

export default function EnglishTimeline(props: TimeLinePageProps) {
  return <TimeLine {...props} />;
}

export async function getServerSideProps(context: any) {
  const result = await getTimelineServerSideProps(context);
  return {
    ...result,
    props: { ...result.props, initialLanguage: "en" as const },
  };
}
