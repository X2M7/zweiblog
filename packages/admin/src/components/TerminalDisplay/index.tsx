import { convertAnsiLinesToHtml } from './ansi';

export default function ({ content }: { content: string }) {
  return (
    <code
      dangerouslySetInnerHTML={{
        __html: convertAnsiLinesToHtml(content),
      }}
    />
  );
}
