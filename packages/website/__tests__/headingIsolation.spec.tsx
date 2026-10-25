// @vitest-environment jsdom
import React from 'react';
import { Viewer } from '@bytemd/react';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { createRoot, hydrateRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Heading, useHeadingNamespace } from '../components/Markdown/heading';
import { getEl, parseNavStructure } from '../components/MarkdownTocBar/tools';
import { sanitizeMarkdownSchema } from '../components/Markdown/sanitizeSchema';

const render = (content: string, namespace = 'test') =>
  renderToStaticMarkup(
    <Viewer value={content} plugins={[Heading(namespace)]} sanitize={sanitizeMarkdownSchema} />,
  );
let root: Root | undefined;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined;
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

function ArticleRenderer({ articleId }: { articleId?: number }) {
  const namespace = useHeadingNamespace(articleId);
  return <Viewer value={'# First\n\n# Second'} plugins={[Heading(namespace)]} sanitize={sanitizeMarkdownSchema} />;
}

describe('heading DOM isolation', () => {
  it('cannot shadow Next bootstrap data or global DOM names', () => {
    document.body.innerHTML =
      render('# __NEXT_DATA__\n\n# __next\n\n# location') +
      '<script id="__NEXT_DATA__" type="application/json">{"ok":true}</script>';
    expect(JSON.parse(document.getElementById('__NEXT_DATA__')!.textContent!)).toEqual({
      ok: true,
    });
    expect(Array.from(document.querySelectorAll('h1')).map((el) => el.id)).toEqual([
      'zb-heading-test-1',
      'zb-heading-test-2',
      'zb-heading-test-3',
    ]);
  });
  it('gives duplicate titles and separate renderers distinct identifiers', () => {
    document.body.innerHTML = render('# Same\n\n# Same', 'a') + render('# Same', 'b');
    const ids = Array.from(document.querySelectorAll('h1')).map((el) => el.id);
    expect(new Set(ids).size).toBe(3);
  });
  it('resolves quoted titles and duplicate TOC entries without a selector injection', () => {
    const source = '# quote " [data-x]\n\n# Same\n\n# Same';
    document.body.innerHTML = render(source);
    const items = parseNavStructure(source);
    expect(items).toHaveLength(3);
    expect(items.map((item) => getEl(item, items)?.id)).toEqual([
      'zb-heading-test-1',
      'zb-heading-test-2',
      'zb-heading-test-3',
    ]);
  });
  it('uses the full text of an inline-formatted heading for the TOC', () => {
    document.body.innerHTML = render('# Hello **world**');
    expect(document.querySelector('h1')?.getAttribute('data-id')).toBe('Hello world');
  });
  it('keeps article permalinks stable through hydration and later client route mounts', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const container = document.createElement('div');
    document.body.append(container);
    container.innerHTML = renderToString(<ArticleRenderer articleId={42} />);
    const ids = () => Array.from(container.querySelectorAll('h1')).map((node) => node.id);
    const serverIds = ids();
    expect(serverIds).toEqual(['zb-heading-article-42-1', 'zb-heading-article-42-2']);
    const recoverableError = vi.fn();
    await act(async () => {
      root = hydrateRoot(container, <ArticleRenderer articleId={42} />, {
        onRecoverableError: recoverableError,
      });
    });
    expect(ids()).toEqual(serverIds);
    expect(recoverableError).not.toHaveBeenCalled();
    act(() => root!.unmount());
    root = createRoot(container);
    await act(async () => root!.render(<ArticleRenderer articleId={9} />));
    await act(async () => root!.render(<ArticleRenderer key="new-route" articleId={42} />));
    expect(ids()).toEqual(serverIds);
  });
  it('keeps list previews and other Markdown instances isolated from article permalinks', () => {
    document.body.innerHTML = renderToString(<>
      <ArticleRenderer articleId={42} />
      <ArticleRenderer />
      <ArticleRenderer />
      <ArticleRenderer articleId={43} />
    </>);
    const ids = Array.from(document.querySelectorAll('h1')).map((node) => node.id);
    expect(new Set(ids).size).toBe(8);
    expect(ids.slice(0, 2)).toEqual(['zb-heading-article-42-1', 'zb-heading-article-42-2']);
    expect(ids.slice(-2)).toEqual(['zb-heading-article-43-1', 'zb-heading-article-43-2']);
  });
});
