import { Viewer } from '@bytemd/react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  isUnsafeCustomCodeEnabled,
  sanitizeCustomHead,
  sanitizeCustomHtml,
} from '../components/CustomLayout/sanitize';
import { sanitizeMarkdownSchema } from '../components/Markdown/sanitizeSchema';
import CommentMarkdown from '../components/CommentMarkdown';
import type { HeadTag } from '../utils/getLayoutProps';

describe('Markdown sanitization', () => {
  it('renders TeX with the same safe viewer used by comment preview and published comments', () => {
    const html = renderToStaticMarkup(
      createElement(CommentMarkdown, {
        content: [
          'Euler: $e^{i\\pi}+1=0$',
          '![safe local image](/static/comment/safe.webp)',
          '![safe remote image](https://images.example/safe.webp)',
          '![blocked data image](data:image/svg+xml,<svg></svg>)',
          '<div class="fixed inset-0 z-50">fake login overlay</div>',
          '<img src="https://images.example/raw.webp" onerror="alert(1)">',
          '<style>body{display:none}</style>',
        ].join('\n\n'),
      }),
    );

    expect(html).toContain('katex');
    expect(html).toContain('Euler');
    expect(html).toContain('src="/static/comment/safe.webp"');
    expect(html).toContain('src="https://images.example/safe.webp"');
    expect(html).not.toContain('data:image');
    expect(html).not.toContain('raw.webp');
    expect(html).not.toContain('onerror');
    expect(html).not.toMatch(/<div[^>]+class="[^"]*fixed/i);
    expect(html).not.toContain('<style');
  });

  it('removes executable extensions while preserving safe HTML', () => {
    const schema = {
      tagNames: ['p', 'strong', 'script', 'iframe'],
      attributes: {
        '*': ['className', 'src', 'style', 'onClick'],
      },
      protocols: {
        href: ['http', 'https', 'javascript', 'data'],
        src: ['http', 'https', 'data'],
      },
      strip: [],
    };

    const sanitized = sanitizeMarkdownSchema(schema);

    expect(sanitized.tagNames).toEqual(expect.arrayContaining(['p', 'strong', 'center']));
    expect(sanitized.tagNames).not.toContain('script');
    expect(sanitized.tagNames).not.toContain('iframe');
    expect(sanitized.attributes['*']).toEqual(['className']);
    expect(sanitized.protocols.href).toEqual(['http', 'https']);
    expect(sanitized.protocols.src).toEqual(['http', 'https']);
    expect(sanitized.strip).toEqual(expect.arrayContaining(['script', 'iframe']));
    expect(schema.tagNames).toContain('script');
  });

  it('removes dangerous raw HTML in the real ByteMD SSR pipeline', () => {
    const html = renderToStaticMarkup(
      createElement(Viewer, {
        value: [
          '<center><strong>safe HTML</strong></center>',
          '<script>window.__xss = 1</script>',
          '<img src="x" onerror="window.__xss = 2">',
          '<a href="javascript:window.__xss = 3">bad link</a>',
          '<iframe src="data:text/html,<script>window.__xss = 4</script>"></iframe>',
        ].join('\n'),
        remarkRehype: { allowDangerousHtml: true },
        sanitize: sanitizeMarkdownSchema,
      }),
    );

    expect(html).toContain('<center><strong>safe HTML</strong></center>');
    expect(html).not.toMatch(/<script|<iframe|onerror|javascript:|data:text\/html/i);
  });
});

describe('CustomLayout sanitization', () => {
  it('keeps normal markup and removes executable HTML', () => {
    const sanitized = sanitizeCustomHtml(`
      <section class="hero" data-theme="dark">
        <p>Hello <strong>world</strong></p>
        <img src="/cover.png" alt="cover" onerror="window.__xss = 1">
        <a href="javascript:window.__xss = 2">bad link</a>
        <a href="data:text/html,<script>window.__xss = 3</script>">data link</a>
        <script>window.__xss = 4</script>
        <iframe src="data:text/html,<script>window.__xss = 5</script>"></iframe>
      </section>
    `);

    expect(sanitized).toContain('<section class="hero" data-theme="dark">');
    expect(sanitized).toContain('<strong>world</strong>');
    expect(sanitized).toContain('src="/cover.png"');
    expect(sanitized).not.toMatch(/<script|<iframe|onerror|javascript:|data:text\/html/i);
  });

  it('allowlists head tags, attributes and URL protocols', () => {
    const tags: HeadTag[] = [
      {
        name: 'meta',
        props: { name: 'description', content: 'safe', onload: 'alert(1)' },
        content: '',
      },
      {
        name: 'meta',
        props: { 'http-equiv': 'refresh', content: '0;url=https://evil.example' },
        content: '',
      },
      {
        name: 'link',
        props: {
          rel: 'stylesheet',
          href: 'https://cdn.example/theme.css',
          onload: 'alert(1)',
        },
        content: '',
      },
      {
        name: 'link',
        props: { rel: 'stylesheet', href: 'data:text/css,body{}' },
        content: '',
      },
      { name: 'title', props: { onclick: 'alert(1)' }, content: 'Safe title' },
      { name: 'base', props: { href: 'https://evil.example/' }, content: '' },
      { name: 'script', props: { src: 'https://evil.example/x.js' }, content: '' },
    ];

    const sanitized = sanitizeCustomHead(tags);

    expect(sanitized.map((tag) => tag.name)).toEqual(['meta', 'link', 'title']);
    expect(sanitized[0].props).toEqual({ name: 'description', content: 'safe' });
    expect(sanitized[1].props).toEqual({
      rel: 'stylesheet',
      href: 'https://cdn.example/theme.css',
    });
    expect(sanitized[2]).toEqual({ name: 'title', props: {}, content: 'Safe title' });
  });

  it('keeps arbitrary custom code disabled unless explicitly enabled', () => {
    expect(isUnsafeCustomCodeEnabled(undefined)).toBe(false);
    expect(isUnsafeCustomCodeEnabled('false')).toBe(false);
    expect(isUnsafeCustomCodeEnabled('true')).toBe(true);
  });
});
