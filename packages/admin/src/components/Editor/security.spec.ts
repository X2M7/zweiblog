import { describe, expect, it } from 'vitest';

import { convertAnsiLinesToHtml } from '../TerminalDisplay/ansi';
import { sanitizeMarkdownSchema } from './sanitizeSchema';

describe('admin rendering sanitization', () => {
  it('keeps the Markdown default security boundary', () => {
    const sanitized = sanitizeMarkdownSchema({
      tagNames: ['p', 'script', 'iframe'],
      attributes: { '*': ['className', 'src', 'style', 'onLoad'] },
      protocols: { src: ['http', 'https', 'data', 'javascript'] },
      strip: [],
    });

    expect(sanitized.tagNames).toEqual(expect.arrayContaining(['p', 'center']));
    expect(sanitized.tagNames).not.toContain('script');
    expect(sanitized.tagNames).not.toContain('iframe');
    expect(sanitized.attributes['*']).toEqual(['className']);
    expect(sanitized.protocols.src).toEqual(['http', 'https']);
    expect(sanitized.strip).toEqual(expect.arrayContaining(['script', 'iframe']));
  });

  it('escapes raw HTML in ANSI log lines while preserving ANSI formatting', () => {
    const html = convertAnsiLinesToHtml(
      '<img src=x onerror="window.__xss = 1">\n\u001b[31mred\u001b[0m',
    );

    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(html).toContain('<br/>');
    expect(html).toContain('red');
    expect(html).toContain('<span');
  });
});
