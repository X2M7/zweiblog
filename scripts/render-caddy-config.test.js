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
  const childEnvironment = {
    ...process.env,
    EMAIL: '',
    ZWEI_BLOG_CADDY_HTTPS: 'off',
    ZWEI_BLOG_CADDY_TRUSTED_PROXIES: '',
    ...environment,
  };
  if (environment.ZWEI_BLOG_CADDY_HTTPS === null) {
    delete childEnvironment.ZWEI_BLOG_CADDY_HTTPS;
  }
  const result = spawnSync(process.execPath, [script, template, output], {
    encoding: 'utf8',
    env: childEnvironment,
  });
  return { result, output };
};

const assertSensitiveHeadersAreRemoved = (config) => {
  const expectedFields = [
    'request>headers>Authorization',
    'request>headers>Cookie',
    'request>headers>Proxy-Authorization',
    'request>headers>Token',
    'request>headers>X-Api-Key',
    'request>headers>X-Auth-Token',
  ];

  for (const loggerName of ['log0', 'log1']) {
    const encoder = config.logging.logs[loggerName].encoder;
    assert.equal(encoder.format, 'filter');
    assert.deepEqual(encoder.wrap, { format: 'json' });
    for (const field of expectedFields) {
      assert.deepEqual(encoder.fields[field], { filter: 'delete' });
    }
  }
};

afterEach(() => {
  while (temporaryDirectories.length) {
    rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

test('renders an HTTP-only Caddy router without certificate automation by default', () => {
  const { result, output } = render({});
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(readFileSync(output, 'utf8'));

  assert.deepEqual(Object.keys(config.apps.http.servers), ['srv1']);
  assert.deepEqual(config.apps.http.servers.srv1.automatic_https, { disable: true });
  assert.equal('tls' in config.apps, false);
  assertSensitiveHeadersAreRemoved(config);
  for (const server of Object.values(config.apps.http.servers)) {
    assert.equal('trusted_proxies' in server, false);
  }
  if (process.platform !== 'win32') assert.equal(statSync(output).mode & 0o777, 0o600);
});

test('enables the explicit on-demand HTTPS listener and applies trusted proxy CIDRs', () => {
  const { result, output } = render({
    EMAIL: 'ops@example.com',
    ZWEI_BLOG_CADDY_HTTPS: 'on-demand',
    ZWEI_BLOG_CADDY_TRUSTED_PROXIES: '172.18.0.1, fd00::/64',
  });
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(readFileSync(output, 'utf8'));
  assertSensitiveHeadersAreRemoved(config);

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
  assert.deepEqual(config.apps.http.servers.srv0.listen, [':443']);
  assert.equal(config.apps.http.servers.srv0.strict_sni_host, true);
});

test('rewrites the Atom feed route to the generated API feed', () => {
  for (const mode of ['off', 'on-demand']) {
    const { result, output } = render({ ZWEI_BLOG_CADDY_HTTPS: mode });
    assert.equal(result.status, 0, result.stderr);
    const config = JSON.parse(readFileSync(output, 'utf8'));

    for (const server of Object.values(config.apps.http.servers)) {
      const atomRoute = server.routes.find((route) =>
        route.match?.[0]?.path?.includes('/atom.xml'),
      );
      const rewrite = atomRoute.handle[0].routes[0].handle.find(
        (handler) => handler.handler === 'rewrite',
      );
      assert.deepEqual(rewrite.uri_substring, [{ find: '/atom.xml', replace: '/rss/atom.xml' }]);
    }
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
  const { result } = render({
    EMAIL: 'not-an-email',
    ZWEI_BLOG_CADDY_HTTPS: 'on-demand',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /EMAIL must be empty or a valid email address/);
});

test('ignores an unused ACME email in HTTP-only mode', () => {
  const { result, output } = render({ EMAIL: 'legacy invalid value' });
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(readFileSync(output, 'utf8'));
  assert.equal('tls' in config.apps, false);
});

test('keeps a legacy EMAIL-only HTTPS deployment reachable with a warning', () => {
  const { result, output } = render({
    EMAIL: 'legacy@example.com',
    ZWEI_BLOG_CADDY_HTTPS: null,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /inferred on-demand HTTPS from legacy EMAIL/);
  const config = JSON.parse(readFileSync(output, 'utf8'));
  assert.deepEqual(config.apps.http.servers.srv0.listen, [':443']);
  assert.equal(config.apps.tls.automation.policies[0].issuers[0].email, 'legacy@example.com');
});

test('defaults an unset legacy mode without EMAIL to HTTP-only', () => {
  const { result, output } = render({ ZWEI_BLOG_CADDY_HTTPS: null });
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(readFileSync(output, 'utf8'));
  assert.equal('tls' in config.apps, false);
});

test('rejects an invalid legacy EMAIL when no explicit mode disambiguates it', () => {
  const { result } = render({
    EMAIL: 'not-an-email',
    ZWEI_BLOG_CADDY_HTTPS: null,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /EMAIL must be valid when inferring HTTPS/);
});

test('rejects unknown HTTPS modes', () => {
  const { result } = render({ ZWEI_BLOG_CADDY_HTTPS: 'automatic' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must be "off" or "on-demand"/);
});
