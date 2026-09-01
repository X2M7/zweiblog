import { Viewer } from '@bytemd/react';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  isTrustedCustomCodeEnabled,
  sanitizeCustomHead,
  sanitizeCustomHtml,
} from '../components/CustomLayout/sanitize';
import {
  normalizeCustomPageIframeSrc,
  sanitizeMarkdownSchema,
} from '../components/Markdown/sanitizeSchema';
import { safeCustomPageIframe } from '../components/Markdown/safeIframe';
import CommentMarkdown from '../components/CommentMarkdown';
import { getLayoutProps, type HeadTag } from '../utils/getLayoutProps';

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
          '<iframe src="/c/latex"></iframe>',
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
    expect(html).not.toContain('<iframe');
    expect(html).not.toMatch(/<div[^>]+class="[^"]*fixed/i);
    expect(html).not.toContain('<style');
  });

  it('caps anonymous-comment TeX dimensions without breaking normal formulas', () => {
    const html = renderToStaticMarkup(
      createElement(CommentMarkdown, {
        content: [
          'Normal: $E = mc^2$',
          'Oversized: $\\rule{999999em}{999999em}$',
        ].join('\n\n'),
      }),
    );

    expect(html).toContain('katex');
    expect(html).toContain('Normal:');
    expect(html).toContain('height:20em');
    expect(html).toContain('border-right-width:20em');
    expect(html).not.toMatch(
      /(?:height|border-(?:right|top)-width)\s*:\s*999999em/i,
    );
  });

  it('allows only sandboxed custom-page iframe attributes while removing executable tags', () => {
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
    expect(sanitized.tagNames).toContain('iframe');
    expect(sanitized.attributes['*']).toEqual(['className']);
    expect(sanitized.attributes.iframe).toEqual(
      expect.arrayContaining([
        expect.arrayContaining(['src', expect.any(RegExp)]),
        expect.arrayContaining(['style', expect.any(RegExp)]),
      ]),
    );
    expect(sanitized.required?.iframe).toMatchObject({
      loading: 'lazy',
      referrerPolicy: 'same-origin',
      allow: 'clipboard-write',
    });
    expect(sanitized.required?.iframe.sandbox).not.toContain('allow-same-origin');
    expect(sanitized.protocols.href).toEqual(['http', 'https']);
    expect(sanitized.protocols.src).toEqual(['http', 'https']);
    expect(sanitized.strip).toEqual(expect.arrayContaining(['script', 'object']));
    expect(sanitized.strip).not.toContain('iframe');
    expect(schema.tagNames).toContain('script');
  });

  it('keeps a safe /c iframe and removes dangerous raw HTML in the real pipeline', () => {
    const html = renderToStaticMarkup(
      createElement(Viewer, {
        value: [
          '<center><strong>safe HTML</strong></center>',
          '<iframe src="/c/latex" sandbox="allow-same-origin allow-top-navigation" allow="clipboard-read *" style="width:100%; height:520px; border:0; border-radius:10px; overflow:hidden;"></iframe>',
          '<iframe src="/c/latex?formula=E%3Dmc%5E2#preview%20pane"></iframe>',
          '<script>window.__xss = 1</script>',
          '<img src="x" onerror="window.__xss = 2">',
          '<a href="javascript:window.__xss = 3">bad link</a>',
          '<iframe src="data:text/html,<script>window.__xss = 4</script>"></iframe>',
          '<iframe src="//evil.example/c/latex"></iframe>',
          '<iframe src="/c/../admin"></iframe>',
        ].join('\n'),
        plugins: [safeCustomPageIframe()],
        remarkRehype: { allowDangerousHtml: true },
        sanitize: sanitizeMarkdownSchema,
      }),
    );

    expect(html).toContain('<center><strong>safe HTML</strong></center>');
    expect(html).toContain('src="/c/latex"');
    expect(html).toContain('src="/c/latex?formula=E%3Dmc%5E2#preview%20pane"');
    expect(html).toContain('height:520px');
    expect(html).toContain('allow="clipboard-write"');
    expect(html).toContain('sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads"');
    expect((html.match(/<iframe/g) || []).length).toBe(2);
    expect(html).not.toMatch(
      /<script|onerror|javascript:|data:text\/html|evil\.example|\/c\/\.\.|allow-same-origin|allow-top-navigation|clipboard-read/i,
    );
  });

  it('normalizes configured same-origin absolute /c embeds during SSR', () => {
    const baseUrl = 'https://xumin.net/blog/';
    const html = renderToStaticMarkup(
      createElement(Viewer, {
        value: [
          '<iframe src="https://xumin.net/c/latex?formula=x%5E2#preview%20pane"></iframe>',
          '<iframe src="https://XUMIN.NET:443/c/tools/demo"></iframe>',
          '<iframe src="https://www.xumin.net/c/latex"></iframe>',
          '<iframe src="http://xumin.net/c/latex"></iframe>',
          '<iframe src="//xumin.net/c/latex"></iframe>',
          '<iframe src="https://xumin.net/c/../admin"></iframe>',
          '<iframe src="https://xumin.net/c/%2e%2e/admin"></iframe>',
          '<iframe src="https://xumin.net.evil.example/c/latex"></iframe>',
        ].join('\n'),
        plugins: [safeCustomPageIframe(baseUrl)],
        remarkRehype: { allowDangerousHtml: true },
        sanitize: (schema) => sanitizeMarkdownSchema(schema, baseUrl),
      }),
    );

    expect(html).toContain('src="/c/latex?formula=x%5E2#preview%20pane"');
    expect(html).toContain('src="/c/tools/demo"');
    expect((html.match(/<iframe/g) || []).length).toBe(2);
    expect(html).not.toMatch(/www\.xumin|http:\/\/xumin|%2e|\.evil\.example|\/c\/\.\./i);
  });

  it('normalizes only root-safe URLs from the configured site origin', () => {
    const baseUrl = 'https://xumin.net:443/some/base/path';

    expect(normalizeCustomPageIframeSrc('/c/latex', baseUrl)).toBe('/c/latex');
    expect(
      normalizeCustomPageIframeSrc('https://xumin.net/c/latex?q=x%5E2#preview', baseUrl),
    ).toBe('/c/latex?q=x%5E2#preview');
    expect(normalizeCustomPageIframeSrc('HTTPS://XUMIN.NET:443/c/latex', baseUrl)).toBe(
      '/c/latex',
    );
    expect(normalizeCustomPageIframeSrc('//xumin.net/c/latex', baseUrl)).toBeNull();
    expect(normalizeCustomPageIframeSrc('https://evil.example/c/latex', baseUrl)).toBeNull();
    expect(normalizeCustomPageIframeSrc('http://xumin.net/c/latex', baseUrl)).toBeNull();
    expect(normalizeCustomPageIframeSrc('https://xumin.net/c/../admin', baseUrl)).toBeNull();
    expect(normalizeCustomPageIframeSrc('https://xumin.net/c/%2e%2e/admin', baseUrl)).toBeNull();
    expect(normalizeCustomPageIframeSrc('https://xumin.net/c/%2Fadmin', baseUrl)).toBeNull();
    expect(normalizeCustomPageIframeSrc('https://xumin.net/c\\latex', baseUrl)).toBeNull();
    expect(normalizeCustomPageIframeSrc('https://xumin.net/c/latex', '')).toBeNull();
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
    expect(isTrustedCustomCodeEnabled(undefined)).toBe(false);
    expect(isTrustedCustomCodeEnabled(false)).toBe(false);
    expect(isTrustedCustomCodeEnabled('false')).toBe(false);
    expect(isTrustedCustomCodeEnabled('TRUE')).toBe(false);
    expect(isTrustedCustomCodeEnabled(true)).toBe(true);
    expect(isTrustedCustomCodeEnabled('true')).toBe(true);
  });
});

describe('runtime compatibility controls', () => {
  it('enables trusted custom code only for an exact operator opt-in', () => {
    const keys = [
      'ZWEI_BLOG_ALLOW_TRUSTED_CUSTOM_CODE',
      'NEXT_PUBLIC_ZWEI_BLOG_ALLOW_UNSAFE_CUSTOM_CODE',
    ] as const;
    const originals = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    const data = {
      version: 'test',
      tags: [],
      tagDetails: [],
      totalArticles: 0,
      totalWordCount: 0,
      menus: [],
      meta: {
        about: { content: '', updatedAt: '' },
        categories: [],
        categoryDetails: [],
        links: [],
        rewards: [],
        socials: [],
        siteInfo: {},
      },
    } as unknown as Parameters<typeof getLayoutProps>[0];

    try {
      for (const key of keys) delete process.env[key];
      expect(getLayoutProps(data).allowTrustedCustomCode).toBe(false);
      expect(getLayoutProps(data).baseUrl).toBe('');

      process.env.ZWEI_BLOG_ALLOW_TRUSTED_CUSTOM_CODE = 'TRUE';
      expect(getLayoutProps(data).allowTrustedCustomCode).toBe(false);
      process.env.ZWEI_BLOG_ALLOW_TRUSTED_CUSTOM_CODE = 'true';
      expect(getLayoutProps(data).allowTrustedCustomCode).toBe(true);

      delete process.env.ZWEI_BLOG_ALLOW_TRUSTED_CUSTOM_CODE;
      process.env.NEXT_PUBLIC_ZWEI_BLOG_ALLOW_UNSAFE_CUSTOM_CODE = 'true';
      expect(getLayoutProps(data).allowTrustedCustomCode).toBe(true);
    } finally {
      for (const key of keys) {
        const original = originals[key];
        if (original === undefined) delete process.env[key];
        else process.env[key] = original;
      }
    }
  });

  it('allows built-in analytics scripts without opening script-src to every origin', async () => {
    const nextConfig = createRequire(import.meta.url)('../next.config.js');
    const routes = await nextConfig.headers();
    const csp = routes[0].headers.find(
      (header: { key: string }) => header.key === 'Content-Security-Policy',
    )?.value;

    expect(csp).toContain('https://hm.baidu.com');
    expect(csp).toContain('https://www.googletagmanager.com');
    expect(csp).not.toMatch(/script-src[^;]*\shttps:\s/);
    expect(csp).not.toMatch(/script-src[^;]*\shttp:\s/);
  });
});
