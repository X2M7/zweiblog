import convert from 'ansi-to-html';

const ansiToHtml = new convert({ escapeXML: true });

export function convertAnsiLinesToHtml(content: string): string {
  return content
    .split('\n')
    .map((line) => ansiToHtml.toHtml(line))
    .join('<br/>');
}
