import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import CommentMarkdown from '../components/CommentMarkdown';
import Markdown from '../components/Markdown';
import { katexStrictMode } from '../components/Markdown/katexOptions';

function renderWithoutUnicodeMathWarnings(element: React.ReactElement) {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

  try {
    const html = renderToStaticMarkup(element);
    const unicodeWarnings = warn.mock.calls.filter(([message]) =>
      String(message).includes('unicodeTextInMathMode'),
    );

    return { html, unicodeWarnings };
  } finally {
    warn.mockRestore();
  }
}

describe('Chinese text in KaTeX formulas', () => {
  it('renders Chinese TeX in articles without emitting an SSR warning', () => {
    const { html, unicodeWarnings } = renderWithoutUnicodeMathWarnings(
      <Markdown content={'正文：$速度 = 距离 / 时间$'} />,
    );

    expect(html).toContain('katex');
    expect(html).toContain('速度');
    expect(html).toContain('距离');
    expect(unicodeWarnings).toEqual([]);
  });

  it('renders Chinese TeX in comments without emitting an SSR warning', () => {
    const { html, unicodeWarnings } = renderWithoutUnicodeMathWarnings(
      <CommentMarkdown content={'评论：$速度 = 距离 / 时间$'} />,
    );

    expect(html).toContain('katex');
    expect(html).toContain('速度');
    expect(html).toContain('时间');
    expect(unicodeWarnings).toEqual([]);
  });

  it('keeps every unrelated KaTeX strict-mode diagnostic enabled', () => {
    expect(katexStrictMode('unicodeTextInMathMode')).toBe('ignore');
    expect(katexStrictMode('unknownSymbol')).toBe('warn');
    expect(katexStrictMode('htmlExtension')).toBe('warn');
  });
});
