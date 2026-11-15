import { Viewer } from '@bytemd/react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { sanitizeMarkdownSchema } from './sanitizeSchema';

function renderMarkdown(value: string) {
  return renderToStaticMarkup(
    createElement(Viewer, {
      value,
      remarkRehype: { allowDangerousHtml: true },
      sanitize: sanitizeMarkdownSchema,
    }),
  );
}

describe('editor presentation style compatibility', () => {
  it.each([
    'color: red;',
    'color:#f00',
    'COLOR: #FF0000 ;',
    'color: #a1B2c3; display:inline;',
  ])('preserves acronym highlighting with %s', (style) => {
    const html = renderMarkdown(`<span style="${style}">p</span>rint`);

    expect(html).toContain(`<span style="${style}">p</span>rint`);
  });

  it.each([
    'color:#ff',
    'color:#fffff',
    'color:redxxx',
    'color:url(https://example.com/image)',
    'color:expression(alert(1))',
    'color:red; position:fixed; inset:0',
    'color:red; background:url(https://example.com/image)',
  ])('still removes unsupported or unsafe color styles: %s', (style) => {
    const html = renderMarkdown(`<span style="${style}">p</span>rint`);

    expect(html).toContain('<span>p</span>rint');
    expect(html).not.toContain('style=');
  });

  it('keeps color outside the iframe style policy', () => {
    const html = renderMarkdown('<iframe src="/c/latex" style="color:red"></iframe>');

    expect(html).toContain('<iframe');
    expect(html).not.toContain('style=');
  });

  it('matches the website flow-layout allowlist', () => {
    const html = renderMarkdown(`
<div align="center" style="display:flex; flex-direction:column; align-items:center; gap:8px; padding:10px;">
  <img
    src="https://images.example/formula.svg"
    alt="formula"
    width="300"
    height="200"
    style="display:block; max-width:100%; height:auto; margin:0 auto 10px; object-fit:contain;"
  >
  <img src="//tex.xumin.net/svg/example" alt="legacy formula" style="display: block; margin-bottom: 10px;">
</div>
    `);

    expect(html).toContain('align="center"');
    expect(html).toContain('width="300"');
    expect(html).toContain('height="200"');
    expect(html).toContain('display:flex');
    expect(html).toContain('align-items:center');
    expect(html).toContain('max-width:100%');
    expect(html).toContain('height:auto');
    expect(html).toContain('margin:0 auto 10px');
    expect(html).toContain('object-fit:contain');
    expect(html).toContain('src="//tex.xumin.net/svg/example"');
    expect(html).toContain('margin-bottom: 10px');
  });

  it('continues removing overlay, executable and event content', () => {
    const html = renderMarkdown(`
<div title="overlay" style="position:fixed; inset:0; z-index:999999">overlay</div>
<img title="url-style" src="https://images.example/a.webp" style="width:100%; background:url(javascript:alert(1))" onerror="alert(2)">
<span title="expression-style" style="width:expression(alert(3)); transform:scale(10)" onclick="alert(4)">text</span>
<script>window.__articleXss = true</script>
    `);

    expect(html).toContain('title="overlay"');
    expect(html).toContain('title="url-style"');
    expect(html).toContain('title="expression-style"');
    expect(html).not.toMatch(
      /position:|inset:|z-index:|background:|url\(|expression\(|transform:|onerror|onclick|<script/i,
    );
  });
});
