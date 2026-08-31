/** @type {import('next').NextConfig} */
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});
const isDev = process.env.NODE_ENV == 'development';
// Next's standalone file tracer copies pnpm's linked dependency tree with
// symlinks. Ordinary Windows accounts cannot create those links without
// Developer Mode/elevation, while the Linux production image can. Keep the
// production container standalone and make a normal local Windows build
// complete without requiring elevated filesystem privileges.
const outputMode = process.platform === 'win32' ? {} : { output: 'standalone' };
// This compatibility-oriented CSP is defense in depth;
// rendering sinks must still sanitize input.
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} https://hm.baidu.com https://www.googletagmanager.com`,
  "style-src 'self' 'unsafe-inline' https:",
  "img-src 'self' data: blob: https: http:",
  "font-src 'self' data: https:",
  "connect-src 'self' https: http: ws: wss:",
  "media-src 'self' data: blob: https: http:",
  "worker-src 'self' blob:",
  "frame-src 'self' https: http:",
  "manifest-src 'self'",
].join('; ');
const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
  },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
];
const rewites =
  process.env.NODE_ENV == 'development'
    ? {
        async rewrites() {
          return [
            {
              source: '/api/:path*',
              destination: 'http://127.0.0.1:3000/api/:path*', // Proxy to Backend
            },
            {
              source: '/static/:path*',
              destination: 'http://127.0.0.1:3000/static/:path*', // Local comment images
            },
          ];
        },
      }
    : {};

const getAllowDomains = () => {
  const domainsInEnv = process.env.ZWEI_BLOG_ALLOW_DOMAINS || '';
  if (domainsInEnv && domainsInEnv != '') {
    const arr = domainsInEnv.split(',');
    return arr;
  } else {
    if (isDev) {
      return ['localhost', '127.0.0.1'];
    }
    return [];
  }
};
const getCdnUrl = () => {
  if (isDev) {
    return {};
  }
  const UrlInEnv = process.env.ZWEI_BLOG_CDN_URL || '';
  if (UrlInEnv && UrlInEnv != '') {
    return { assetPrefix: UrlInEnv };
  } else {
    return {};
  }
};
module.exports = withBundleAnalyzer({
  reactStrictMode: true,
  ...outputMode,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
  experimental: {
    largePageDataBytes: 1024 * 1024 * 10,
  },
  images: {
    domains: getAllowDomains(),
  },
  ...getCdnUrl(),
  ...rewites,
});
