// Keep this policy identical in the website and admin editor.
// Accept the official share snippet's // URL, then always emit HTTPS.
export const SAFE_BILIBILI_IFRAME_SRC =
  /^(?:https:)?\/\/player\.bilibili\.com\/player\.html\?[a-zA-Z0-9_=&.%+-]+$/;

/** Rebuild the URL from supported playback parameters; never forward arbitrary options. */
export function normalizeBilibiliIframeSrc(src: unknown): string | null {
  if (typeof src !== 'string' || !SAFE_BILIBILI_IFRAME_SRC.test(src)) return null;
  const input = new URL(src.startsWith('//') ? `https:${src}` : src).searchParams;
  const output = new URL('https://player.bilibili.com/player.html');
  const bvid = input.get('bvid');
  const aid = input.get('aid');
  if (bvid && /^BV[a-zA-Z0-9]{10}$/.test(bvid)) {
    output.searchParams.set('bvid', bvid);
  } else if (aid && /^[1-9]\d{0,15}$/.test(aid)) {
    output.searchParams.set('aid', aid);
  } else {
    return null;
  }

  for (const name of ['cid', 'p', 't']) {
    const value = input.get(name);
    const pattern = name === 't' ? /^\d{1,10}(?:\.\d{1,3})?$/ : /^[1-9]\d{0,15}$/;
    if (value && pattern.test(value)) output.searchParams.set(name, value);
  }
  const danmaku = input.get('danmaku');
  if (danmaku === '0' || danmaku === 'false') output.searchParams.set('danmaku', '0');
  // The player shows its own cover and play button, including without blog JS.
  output.searchParams.set('autoplay', '0');
  output.searchParams.set('poster', '1');
  return output.href;
}

export function sanitizeBilibiliIframeProperties(
  properties?: Record<string, unknown>,
): Record<string, unknown> | null {
  const src = normalizeBilibiliIframeSrc(properties?.src);
  if (!src) return null;
  return {
    src,
    title: typeof properties?.title === 'string' && properties.title.trim()
      ? properties.title
      : 'Bilibili 视频播放器',
    // Storage and API requests need the player's own origin. This exception is
    // restricted to the external player, never to same-origin /c applications.
    sandbox: ['allow-scripts', 'allow-same-origin', 'allow-presentation', 'allow-popups'],
    allow: 'fullscreen; picture-in-picture; encrypted-media',
    allowFullScreen: true,
    loading: 'lazy',
    referrerPolicy: 'strict-origin-when-cross-origin',
    frameBorder: '0',
    scrolling: 'no',
    style: 'display:block;width:100%;height:auto;aspect-ratio:16 / 9;border:0;',
  };
}
