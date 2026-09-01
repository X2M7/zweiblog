import type { Response } from 'express';

const CUSTOM_PAGE_SANDBOX_TOKENS = [
  'allow-scripts',
  'allow-forms',
  'allow-modals',
  'allow-popups',
  'allow-popups-to-escape-sandbox',
  'allow-downloads',
];

const CUSTOM_PAGE_RESOURCE_DIRECTIVES = [
  "default-src 'self' https: http: data: blob:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https: http: blob:",
  "style-src 'self' 'unsafe-inline' https: http:",
  "img-src 'self' https: http: data: blob:",
  "connect-src 'self' https: http: wss: ws:",
  // Explicit fallbacks keep ordinary static applications working across CSP
  // implementations without changing an isolated page's opaque origin.
  // Before this directive existed, workers inherited script-src and could be
  // loaded from HTTP(S). Keep that compatibility for complete static apps;
  // isolated pages still have an opaque origin and trusted mode is an explicit
  // operator choice.
  "worker-src 'self' https: http: blob: data:",
  "frame-src 'self' https: http: data: blob:",
  "media-src 'self' https: http: data: blob:",
];

export function getCustomPageCsp(sandboxMode: unknown) {
  const trusted = sandboxMode === 'trusted';
  const sandboxTokens = [...CUSTOM_PAGE_SANDBOX_TOKENS];
  if (trusted) {
    sandboxTokens.push('allow-same-origin', 'allow-top-navigation-by-user-activation');
  }

  return [
    `sandbox ${sandboxTokens.join(' ')}`,
    ...CUSTOM_PAGE_RESOURCE_DIRECTIVES,
    // Trusted pages may display project PDFs through <object>/<embed>, but
    // plugins from arbitrary HTTP(S) origins remain blocked.
    trusted ? "object-src 'self'" : "object-src 'none'",
    "base-uri 'self' https: http:",
    "frame-ancestors 'self'",
  ].join('; ');
}

export function setCustomPageSecurityHeaders(
  res: Pick<Response, 'setHeader'>,
  sandboxMode: unknown,
) {
  // Isolated pages intentionally receive an opaque origin. Trusted mode is an
  // explicit operator choice and adds only same-origin APIs and user-activated
  // top-level navigation; unrestricted top-level navigation remains blocked.
  res.setHeader('Content-Security-Policy', getCustomPageCsp(sandboxMode));
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Custom-page project files are public assets. This lets isolated pages load
  // same-project ES modules even though their sandboxed origin is opaque.
  res.setHeader('Access-Control-Allow-Origin', '*');
}
