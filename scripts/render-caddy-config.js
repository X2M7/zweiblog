#!/usr/bin/env node

const { readFileSync, writeFileSync } = require('node:fs');
const { isIP } = require('node:net');

const [inputPath = '/app/caddyTemplate.json', outputPath = '/app/caddy.json'] = process.argv.slice(2);
const config = JSON.parse(readFileSync(inputPath, 'utf8'));
const email = (process.env.EMAIL || '').trim();

if (email && !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)) {
  throw new Error('EMAIL must be empty or a valid email address');
}

const issuers = config?.apps?.tls?.automation?.policies?.flatMap((policy) => policy.issuers || []);
for (const issuer of issuers || []) {
  // Caddy's ACME issuer accepts an account email. The ZeroSSL issuer module
  // does not expose this field and rejects the whole config if it is present.
  if (email && issuer.module === 'acme') issuer.email = email;
  else delete issuer.email;
}

const normalizeRange = (value) => {
  const parts = value.trim().split('/');
  if (parts.length > 2) throw new Error(`Invalid trusted proxy range: ${value}`);

  const family = isIP(parts[0]);
  if (!family) throw new Error(`Invalid trusted proxy address: ${value}`);
  if (parts.length === 1) return `${parts[0]}/${family === 4 ? 32 : 128}`;

  if (!/^\d+$/.test(parts[1])) throw new Error(`Invalid trusted proxy prefix: ${value}`);
  const prefix = Number(parts[1]);
  const maximum = family === 4 ? 32 : 128;
  if (prefix < 1 || prefix > maximum) throw new Error(`Invalid trusted proxy prefix: ${value}`);
  return `${parts[0]}/${prefix}`;
};

const trustedProxyInput = process.env.ZWEI_BLOG_CADDY_TRUSTED_PROXIES || '';
if (trustedProxyInput.length > 4096) throw new Error('Trusted proxy configuration is too long');
const trustedProxyRanges = trustedProxyInput
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
  .map(normalizeRange);
if (trustedProxyRanges.length > 64) throw new Error('Too many trusted proxy ranges');

if (trustedProxyRanges.length) {
  const servers = config?.apps?.http?.servers || {};
  for (const server of Object.values(servers)) {
    server.trusted_proxies = { source: 'static', ranges: trustedProxyRanges };
    server.trusted_proxies_strict = 1;
    server.client_ip_headers = ['X-Forwarded-For', 'X-Real-IP'];
  }
}

writeFileSync(outputPath, `${JSON.stringify(config)}\n`, { mode: 0o600 });
