'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const dockerfile = fs.readFileSync(path.join(__dirname, '..', 'Dockerfile'), 'utf8');

for (const [stageName, packageDirectory, packageName] of [
  ['server_builder', 'server', '@zweiblog/server'],
  ['runtime_deps_builder', 'cli', 'zweiblog-cli'],
]) {
  test(`${packageName} runtime packaging gives each pnpm importer a separate bin directory`, () => {
    const stage = dockerfile.split(/(?=^FROM )/m).find((part) =>
      part.split('\n', 1)[0].endsWith(` AS ${stageName}`));
    assert.ok(stage, `missing ${stageName}`);
    const workdir = stage.match(/^WORKDIR (\S+)$/m)?.[1];
    assert.ok(workdir && path.posix.isAbsolute(workdir));
    const install = stage.replace(/\\\n\s*/g, ' ').split('\n').find((line) =>
      line.startsWith(`RUN pnpm --filter ${packageName} install --prod `));
    assert.ok(install, 'runtime dependencies must have a dedicated production install');
    const modulesOption = install.match(/--modules-dir (\S+)/)?.[1];
    const virtualStore = install.match(/--virtual-store-dir (\S+)/)?.[1];
    assert.ok(modulesOption && virtualStore);

    // pnpm 8 includes the root importer even for a filtered install, and links
    // both importers concurrently. Equal paths race during unlink/write/chmod.
    const rootModules = path.posix.resolve(workdir, modulesOption);
    const packageModules = path.posix.resolve(workdir, 'packages', packageDirectory, modulesOption);
    assert.notEqual(rootModules, packageModules, 'root and package importers must not share .bin');
    assert.equal(virtualStore, path.posix.join(packageModules, '.pnpm'));
    assert.match(install, /--frozen-lockfile\b/);
    assert.match(install, /--offline\b/);
  });
}
