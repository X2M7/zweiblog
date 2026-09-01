const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

test('release workflow validates one package version before every image build', () => {
  const workflow = fs.readFileSync(
    path.join(repoRoot, '.github', 'workflows', 'release.yml'),
    'utf8',
  );

  assert.match(
    workflow,
    /outputs:\s*\n\s+app_version: \$\{\{ steps\.app-version\.outputs\.value \}\}/,
  );
  assert.match(workflow, /app_version="\$\(node scripts\/resolve-app-version\.js\)"/);
  assert.match(workflow, /ZWEI_BLOG_VERSIONS=\$\{\{ steps\.app-version\.outputs\.value \}\}/);
  assert.match(workflow, /ZWEI_BLOG_VERSIONS=\$\{\{ needs\.verify\.outputs\.app_version \}\}/);
  assert.doesNotMatch(workflow, /ZWEI_BLOG_VERSIONS=\$\{\{ steps\.meta\.outputs\.version \}\}/);
  assert.doesNotMatch(workflow, /push:\s*\n\s+branches:/);
  assert.equal(
    workflow.match(
      /type=raw,value=latest,enable=\$\{\{ startsWith\(github\.ref, 'refs\/tags\/v'\) \|\| github\.ref == 'refs\/heads\/main' \}\}/g,
    )?.length,
    2,
  );
});

test('the Dockerfile injects the same version into Next and the runtime image', () => {
  const dockerfile = fs.readFileSync(path.join(repoRoot, 'Dockerfile'), 'utf8');
  const websiteStage = dockerfile.slice(
    dockerfile.indexOf('FROM node:22-alpine AS WEBSITE_BUILDER'),
    dockerfile.indexOf('FROM node:22-alpine AS RUNNER'),
  );
  const runnerStage = dockerfile.slice(dockerfile.indexOf('FROM node:22-alpine AS RUNNER'));

  for (const stage of [websiteStage, runnerStage]) {
    assert.match(stage, /ARG ZWEI_BLOG_VERSIONS=dev/);
    assert.match(stage, /ENV ZWEI_BLOG_VERSION=\$\{ZWEI_BLOG_VERSIONS\}/);
  }
});
