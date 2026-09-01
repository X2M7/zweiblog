const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const { resolveAppVersion } = require('./resolve-app-version');
const rootPackage = require('../package.json');

test('main builds use the package version instead of an image tag', () => {
  assert.equal(resolveAppVersion('1.0.0', 'branch', 'main'), 'v1.0.0');
});

test('a release tag must exactly match the package version', () => {
  assert.equal(resolveAppVersion('1.2.3', 'tag', 'v1.2.3'), 'v1.2.3');
  assert.throws(
    () => resolveAppVersion('1.2.3', 'tag', 'v1.2.4'),
    /does not match package version v1\.2\.3/,
  );
});

test('invalid or ambiguous versions are rejected', () => {
  for (const version of ['latest', 'v1.0.0', '01.0.0', '1.0']) {
    assert.throws(() => resolveAppVersion(version, 'branch', 'main'));
  }
});

test('the CLI resolves the current root package version', () => {
  const script = path.resolve(__dirname, 'resolve-app-version.js');
  const expectedVersion = `v${rootPackage.version}`;
  const output = execFileSync(process.execPath, [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_REF_TYPE: 'branch',
      GITHUB_REF_NAME: 'main',
    },
  });

  assert.equal(output.trim(), expectedVersion);

  const mismatch = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_REF_TYPE: 'tag',
      GITHUB_REF_NAME: 'v9.9.9',
    },
  });
  assert.notEqual(mismatch.status, 0);
  assert.ok(mismatch.stderr.includes(`does not match package version ${expectedVersion}`));
});
