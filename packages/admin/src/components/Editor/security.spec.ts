import { Viewer } from '@bytemd/react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { convertAnsiLinesToHtml } from '../TerminalDisplay/ansi';
import { safeCustomPageIframe } from './safeIframe';
import { normalizeCustomPageIframeSrc, sanitizeMarkdownSchema } from './sanitizeSchema';

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
    expect(sanitized.tagNames).toContain('iframe');
    expect(sanitized.attributes['*']).toEqual(['className']);
    expect(sanitized.attributes.iframe).toEqual(
      expect.arrayContaining([
        expect.arrayContaining(['src', expect.any(RegExp)]),
        expect.arrayContaining(['style', expect.any(RegExp)]),
      ]),
    );
    expect(sanitized.required.iframe.sandbox).not.toContain('allow-same-origin');
    expect(sanitized.required.iframe.allow).toBe('clipboard-write');
    expect(sanitized.protocols.src).toEqual(['http', 'https']);
    expect(sanitized.strip).toEqual(expect.arrayContaining(['script', 'object']));
    expect(sanitized.strip).not.toContain('iframe');
  });

  it('matches the published article iframe policy in editor preview', () => {
    const html = renderToStaticMarkup(
      createElement(Viewer, {
        value: [
          '<iframe src="/c/latex" sandbox="allow-same-origin allow-top-navigation" allow="clipboard-read *" style="width:100%; height:520px; border:0;"></iframe>',
          '<iframe src="/c/latex?formula=x%5E2#preview%20pane"></iframe>',
          '<iframe src="https://evil.example/c/latex"></iframe>',
          '<iframe src="/c/%2e%2e/admin"></iframe>',
          '<iframe src="/c/safe" style="position:fixed; inset:0"></iframe>',
        ].join('\n'),
        plugins: [safeCustomPageIframe()],
        remarkRehype: { allowDangerousHtml: true },
        sanitize: sanitizeMarkdownSchema,
      }),
    );

    expect(html).toContain('src="/c/latex"');
    expect(html).toContain('src="/c/latex?formula=x%5E2#preview%20pane"');
    expect(html).toContain('height:520px');
    expect(html).toContain('allow="clipboard-write"');
    expect(html).toContain(
      'sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads"',
    );
    expect((html.match(/<iframe/g) || []).length).toBe(3);
    expect(html).toContain('src="/c/safe"');
    expect(html).not.toContain('position:fixed');
    expect(html).not.toMatch(
      /evil\.example|%2e|allow-same-origin|allow-top-navigation|clipboard-read/i,
    );
  });

  it('uses the configured site URL for absolute /c embeds in editor preview', () => {
    const baseUrl = 'https://xumin.net/';
    const html = renderToStaticMarkup(
      createElement(Viewer, {
        value: [
          '<iframe src="https://xumin.net/c/latex?formula=x%5E2"></iframe>',
          '<iframe src="https://evil.example/c/latex"></iframe>',
          '<iframe src="//xumin.net/c/latex"></iframe>',
          '<iframe src="https://xumin.net/c/../admin"></iframe>',
          '<iframe src="https://xumin.net/c/%2e%2e/admin"></iframe>',
        ].join('\n'),
        plugins: [safeCustomPageIframe(baseUrl)],
        remarkRehype: { allowDangerousHtml: true },
        sanitize: (schema) => sanitizeMarkdownSchema(schema, baseUrl),
      }),
    );

    expect(html).toContain('src="/c/latex?formula=x%5E2"');
    expect((html.match(/<iframe/g) || []).length).toBe(1);
    expect(html).not.toMatch(/evil\.example|\/\/xumin|%2e|\/c\/\.\./i);
  });

  it('normalizes only safe configured-origin iframe sources', () => {
    expect(normalizeCustomPageIframeSrc('https://xumin.net/c/latex', 'https://xumin.net')).toBe(
      '/c/latex',
    );
    expect(normalizeCustomPageIframeSrc('/c/latex', 'https://xumin.net')).toBe('/c/latex');
    expect(normalizeCustomPageIframeSrc('//xumin.net/c/latex', 'https://xumin.net')).toBeNull();
    expect(
      normalizeCustomPageIframeSrc('https://other.example/c/latex', 'https://xumin.net'),
    ).toBeNull();
    expect(
      normalizeCustomPageIframeSrc('https://xumin.net/c/%2e%2e/admin', 'https://xumin.net'),
    ).toBeNull();
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
