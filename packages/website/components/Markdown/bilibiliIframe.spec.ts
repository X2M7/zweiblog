import { getProcessor } from 'bytemd';
import { describe, expect, it } from 'vitest';

import { normalizeBilibiliIframeSrc } from './bilibiliIframe';
import { safeCustomPageIframe } from './safeIframe';
import { sanitizeMarkdownSchema } from './sanitizeSchema';

const player = 'https://player.bilibili.com/player.html';
const bvid = 'BV1B7411m7LV';

function render(value: string) {
  return String(getProcessor({
    sanitize: (schema) => sanitizeMarkdownSchema(schema, 'https://xumin.net'),
    plugins: [safeCustomPageIframe('https://xumin.net')],
  }).processSync(value));
}

describe('Bilibili article embeds', () => {
  it.each(['https:', ''])('renders the official %s share URL as a paused responsive player', (scheme) => {
    const html = render(`<iframe src="${scheme}//player.bilibili.com/player.html?bvid=${bvid}&autoplay=1&autoplay=1" title="课程视频"></iframe>`);
    expect(html).toContain(`${player}?bvid=${bvid}&#x26;autoplay=0&#x26;poster=1`);
    expect(html).toContain('title="课程视频"');
    expect(html).toContain('width:100%;height:auto;aspect-ratio:16 / 9');
    expect(html).toContain('allowfullscreen');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('allow="fullscreen; picture-in-picture; encrypted-media"');
    expect(html).toContain('sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"');
    expect(html).not.toContain('autoplay=1');
  });

  it('preserves video selection and supported playback options', () => {
    const result = normalizeBilibiliIframeSrc(`${player}?aid=12345&cid=45678&p=2&t=12.5&danmaku=false&isOutside=true&muted=1`);
    expect(result).toBe(`${player}?aid=12345&cid=45678&p=2&t=12.5&danmaku=0&autoplay=0&poster=1`);
    expect(normalizeBilibiliIframeSrc(`${player}?bvid=${bvid}&p=3`)).toContain('&p=3&');
  });

  it.each([
    `http://player.bilibili.com/player.html?bvid=${bvid}`,
    `https://player.bilibili.com.evil.example/player.html?bvid=${bvid}`,
    `https://player.bilibili.com@evil.example/player.html?bvid=${bvid}`,
    `https://evil.example@player.bilibili.com/player.html?bvid=${bvid}`,
    `https://player.bilibili.com:8080/player.html?bvid=${bvid}`,
    `https://player.bilibili.com/other.html?bvid=${bvid}`,
    `https://player.bilibili.com/../player.html?bvid=${bvid}`,
    `https://player.bilibili.com/%2e%2e/player.html?bvid=${bvid}`,
    `https://player.bilibili.com\\player.html?bvid=${bvid}`,
    `https://www.bilibili.com/video/${bvid}`,
    `${player}?bvid=invalid`,
    `${player}?aid=-123`,
    `${player}?cid=123`,
    `${player}?bvid=${bvid}#fragment`,
    'javascript:alert(1)',
    'data:text/html,test',
  ])('removes unsupported iframe sources: %s', (src) => {
    expect(normalizeBilibiliIframeSrc(src)).toBeNull();
    expect(render(`<iframe src="${src}"></iframe>`)).not.toContain('<iframe');
  });

  it('strips unsupported parameters, executable attributes and author-supplied permissions', () => {
    const html = render(`<iframe src="${player}?bvid=${bvid}&p=-1&t=oops&redirect=https%3A%2F%2Fevil.example" srcdoc="bad" onload="alert(1)" sandbox="allow-top-navigation" allow="camera; microphone" style="position:fixed;inset:0"></iframe>`);
    expect(html).toContain('<iframe');
    expect(html).not.toMatch(/srcdoc|onload|allow-top-navigation|camera|microphone|position|redirect|evil|p=-1|t=oops/);
  });

  it('keeps custom pages isolated even alongside an external player', () => {
    const html = render(`<iframe src="${player}?bvid=${bvid}"></iframe>\n\n<iframe src="https://xumin.net/c/latex" sandbox="allow-same-origin" allow="fullscreen" style="height:520px"></iframe>`);
    const customPage = html.match(/<iframe src="\/c\/latex"[^>]*>/)?.[0];
    expect(customPage).toBeDefined();
    expect(customPage).toContain('allow="clipboard-write"');
    expect(customPage).toContain('height:520px');
    expect(customPage).not.toContain('allow-same-origin');
  });

  it('revalidates iframe properties introduced after the built-in sanitizer', () => {
    const html = String(getProcessor({
      sanitize: sanitizeMarkdownSchema,
      plugins: [
        {
          rehype: (processor) => processor.use(() => (tree: any) => {
            for (const src of [`${player}?bvid=${bvid}&autoplay=1`, 'https://evil.example/']) {
              tree.children.push({
                type: 'element', tagName: 'iframe', children: [],
                properties: { src, srcDoc: '<script>bad()</script>', onLoad: 'bad()', allow: 'camera' },
              });
            }
          }),
        },
        safeCustomPageIframe(),
      ],
    }).processSync('正文'));
    expect((html.match(/<iframe/g) || []).length).toBe(1);
    expect(html).toContain('autoplay=0');
    expect(html).not.toMatch(/srcdoc|onload|camera|evil|autoplay=1/i);
  });
});
