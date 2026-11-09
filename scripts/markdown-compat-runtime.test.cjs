const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');

const docsRequire = createRequire(path.resolve(__dirname, '../docs/package.json'));
const themeRequire = createRequire(docsRequire.resolve('vuepress-theme-hope'));
const pluginRequire = createRequire(themeRequire.resolve('vuepress-plugin-md-enhance'));
const MarkdownIt = pluginRequire('markdown-it');

for (const [name, input, expected] of [
  ['footnote', 'Note[^1]\n\n[^1]: Footnote text', /footnote-ref/],
  ['tasklist', '- [x] Finished', /checkbox/],
  ['alert', '> [!NOTE]\n> Notice', /Notice/],
]) {
  for (const format of ['commonjs', 'esm']) {
    test(`Markdown security upgrade preserves ${name} (${format})`, async () => {
      const packageName = `@mdit/plugin-${name}`;
      const packageRoot = path.dirname(pluginRequire.resolve(`${packageName}/package.json`));
      const plugin = format === 'commonjs'
        ? pluginRequire(packageName)
        : await import(pathToFileURL(path.join(packageRoot, 'lib/index.mjs')).href);
      const html = new MarkdownIt().use(plugin[name]).render(input);
      assert.match(html, expected);
    });
  }
}
