import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Viewer } from '@bytemd/react';
import { expect, it, vi } from 'vitest';
import { customContainer } from '../components/Markdown/customContainer';
import { Layers } from '../components/Markdown/layers';
import { sanitizeMarkdownSchema } from '../components/Markdown/sanitizeSchema';

const require = createRequire(import.meta.url);
const { JSDOM } = require(require.resolve('jsdom', {
  paths: [require.resolve('isomorphic-dompurify')],
}));

it.each(['\n\n', '\n', '  \n'])('switches independent layer groups with separator %j and cleanup', (separator) => {
  const group = `:::layers\n![Front](/front.svg)${separator}![Back](/back.svg)\n\nShared caption\n:::`;
  const html = renderToStaticMarkup(createElement(Viewer, {
    value: `${group}\n\n${group}`,
    plugins: [customContainer()],
    sanitize: sanitizeMarkdownSchema,
  }));
  expect(html).toContain('class="layer-viewer"');
  expect(html).not.toContain('custom-container-title');
  const dom = new JSDOM(html);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
  try {
    const body = dom.window.document.body;
    const cleanup = Layers().viewerEffect!({ markdownBody: body } as any);
    const groups = body.querySelectorAll('.layer-viewer');
    expect(groups[0].querySelectorAll('p')[1].hidden).toBe(true);
    groups[0].querySelectorAll('button')[1].click();
    expect(groups[0].querySelectorAll('p')[0].hidden).toBe(true);
    expect(groups[0].querySelectorAll('p')[1].hidden).toBe(false);
    expect(groups[0].querySelectorAll('button')[1].getAttribute('aria-pressed')).toBe('true');
    expect(groups[1].querySelectorAll('p')[0].hidden).toBe(false);
    expect(groups[0].querySelectorAll('p')[2].hidden).toBe(false);
    expect(groups[0].querySelectorAll('p')[2].textContent).toBe('Shared caption');
    if (typeof cleanup === 'function') cleanup();
    expect(body.querySelectorAll('button').length).toBe(0);
    expect(body.querySelectorAll('[hidden]').length).toBe(0);
  } finally {
    vi.unstubAllGlobals();
    dom.window.close();
  }
});
