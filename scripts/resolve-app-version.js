#!/usr/bin/env node

'use strict';

const path = require('node:path');

// SemVer 2.0.0, including optional prerelease and build metadata. Numeric
// core identifiers and numeric prerelease identifiers may not have leading
// zeroes.
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function resolveAppVersion(packageVersion, refType, refName) {
  if (typeof packageVersion !== 'string' || !semverPattern.test(packageVersion)) {
    throw new Error(`Invalid package version: ${String(packageVersion)}`);
  }

  const appVersion = `v${packageVersion}`;
  if (refType === 'tag' && refName !== appVersion) {
    throw new Error(`Tag ${refName || '(missing)'} does not match package version ${appVersion}`);
  }

  return appVersion;
}

function readRootPackageVersion() {
  const packagePath = path.resolve(__dirname, '..', 'package.json');
  return require(packagePath).version;
}

if (require.main === module) {
  try {
    process.stdout.write(
      `${resolveAppVersion(
        readRootPackageVersion(),
        process.env.GITHUB_REF_TYPE,
        process.env.GITHUB_REF_NAME,
      )}\n`,
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = { resolveAppVersion, semverPattern };
