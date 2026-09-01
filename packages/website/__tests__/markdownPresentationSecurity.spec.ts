import { Viewer } from '@bytemd/react';
import math from '@bytemd/plugin-math-ssr';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { sanitizeMarkdownSchema } from '../components/Markdown/sanitizeSchema';

function renderMarkdown(value: string) {
  return renderToStaticMarkup(
    createElement(Viewer, {
      value,
      plugins: [math()],
      remarkRehype: { allowDangerousHtml: true },
      sanitize: sanitizeMarkdownSchema,
    }),
  );
}

describe('article presentation style compatibility', () => {
  it('keeps common flow layout styles and legacy display attributes', () => {
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

  it('keeps a safely rotated TeX arrow used between display equations', () => {
    const html = renderMarkdown(`
<span style="display: flex; flex-direction: row; justify-content: center; transform:rotate(90deg);">$\\rightsquigarrow$</span>
    `);

    expect(html).toContain('display: flex');
    expect(html).toContain('flex-direction: row');
    expect(html).toContain('justify-content: center');
    expect(html).toContain('transform:rotate(90deg)');
    expect(html).toContain('class="katex"');
    expect(html).toContain('rightsquigarrow');
    expect(html).not.toContain('$\\rightsquigarrow$');
  });

  it('drops the complete style attribute when it contains active or overlay CSS', () => {
    const html = renderMarkdown(`
<div title="overlay" style="position:fixed; inset:0; z-index:999999">overlay</div>
<img title="url-style" src="https://images.example/a.webp" style="width:100%; background:url(javascript:alert(1))" onerror="alert(2)">
<span title="expression-style" style="width:expression(alert(3)); transform:scale(10)" onclick="alert(4)">text</span>
<span title="scale-style" style="transform:scale(10)">scale</span>
<span title="translate-style" style="transform:translate(100vw, 100vh)">translate</span>
<script>window.__articleXss = true</script>
    `);

    expect(html).toContain('title="overlay"');
    expect(html).toContain('title="url-style"');
    expect(html).toContain('title="expression-style"');
    expect(html).toContain('title="scale-style"');
    expect(html).toContain('title="translate-style"');
    expect(html).not.toMatch(/position:|inset:|z-index:|background:|url\(|expression\(|transform:|onerror|onclick|<script/i);
  });

  it('does not broaden iframe styling through the ordinary element policy', () => {
    const schema = sanitizeMarkdownSchema({
      attributes: { '*': ['style'] },
      protocols: { src: ['http', 'https'] },
      tagNames: ['div', 'iframe'],
    });
    const iframeRules = schema.attributes.iframe;
    const ordinaryRules = schema.attributes.div;

    expect(ordinaryRules).toEqual(
      expect.arrayContaining([expect.arrayContaining(['style', expect.any(RegExp)])]),
    );
    expect(iframeRules).toEqual(
      expect.arrayContaining([expect.arrayContaining(['style', expect.any(RegExp)])]),
    );
    expect(ordinaryRules).not.toBe(iframeRules);
  });
});
