import { MarkdownProvider } from './markdown.provider';

describe('MarkdownProvider RSS rendering', () => {
  const provider = new MarkdownProvider();

  it('escapes raw HTML and event handlers', () => {
    const rendered = provider.renderMarkdown('<img src=x onerror=alert(1)><script>alert(1)</script>');
    expect(rendered).not.toContain('<script>');
    expect(rendered).not.toContain('<img');
    expect(rendered).toContain('&lt;script&gt;');
  });

  it('escapes Mermaid fence content', () => {
    const rendered = provider.renderMarkdown('```mermaid\n</div><script>alert(1)</script>\n```');
    expect(rendered).not.toContain('<script>');
    expect(rendered).toContain('&lt;script&gt;');
  });
});
