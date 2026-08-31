const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync, statSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
const { afterEach, test } = require('node:test');

const script = resolve(__dirname, 'render-caddy-config.js');
const template = resolve(__dirname, '..', 'caddyTemplate.json');
const temporaryDirectories = [];

const render = (environment) => {
  const directory = mkdtempSync(join(tmpdir(), 'zweiblog-caddy-'));
  temporaryDirectories.push(directory);
  const output = join(directory, 'caddy.json');
  const result = spawnSync(process.execPath, [script, template, output], {
    encoding: 'utf8',
    env: {
      ...process.env,
      EMAIL: '',
      ZWEI_BLOG_CADDY_TRUSTED_PROXIES: '',
      ...environment,
    },
  });
  return { result, output };
};

afterEach(() => {
  while (temporaryDirectories.length) {
    rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

test('renders an email-free Caddy config without trusting outer proxies by default', () => {
  const { result, output } = render({});
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(readFileSync(output, 'utf8'));

  for (const policy of config.apps.tls.automation.policies) {
    for (const issuer of policy.issuers) assert.equal('email' in issuer, false);
  }
  for (const server of Object.values(config.apps.http.servers)) {
    assert.equal('trusted_proxies' in server, false);
  }
  if (process.platform !== 'win32') assert.equal(statSync(output).mode & 0o777, 0o600);
});

test('adds validated proxy CIDRs to every bundled Caddy listener', () => {
  const { result, output } = render({
    EMAIL: 'ops@example.com',
    ZWEI_BLOG_CADDY_TRUSTED_PROXIES: '172.18.0.1, fd00::/64',
  });
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(readFileSync(output, 'utf8'));

  for (const policy of config.apps.tls.automation.policies) {
    for (const issuer of policy.issuers) {
      if (issuer.module === 'acme') assert.equal(issuer.email, 'ops@example.com');
      else assert.equal('email' in issuer, false);
    }
  }
  for (const server of Object.values(config.apps.http.servers)) {
    assert.deepEqual(server.trusted_proxies, {
      source: 'static',
      ranges: ['172.18.0.1/32', 'fd00::/64'],
    });
    assert.equal(server.trusted_proxies_strict, 1);
    assert.deepEqual(server.client_ip_headers, ['X-Forwarded-For', 'X-Real-IP']);
  }
});

test('rejects invalid trusted proxy ranges instead of starting insecurely', () => {
  const { result } = render({ ZWEI_BLOG_CADDY_TRUSTED_PROXIES: '0.0.0.0/99' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid trusted proxy prefix/);
});

test('rejects all-network proxy ranges', () => {
  for (const range of ['0.0.0.0/0', '::/0']) {
    const { result } = render({ ZWEI_BLOG_CADDY_TRUSTED_PROXIES: range });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Invalid trusted proxy prefix/);
  }
});

test('rejects malformed ACME email addresses', () => {
  const { result } = render({ EMAIL: 'not-an-email' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /EMAIL must be empty or a valid email address/);
});
