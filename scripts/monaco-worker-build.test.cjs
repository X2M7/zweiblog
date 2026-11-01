'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { gzipSync } = require('node:zlib');

const root = path.resolve(__dirname, '..');
const adminRequire = createRequire(path.join(root, 'packages/admin/package.json'));
const ts = adminRequire('typescript');
const workerPath = adminRequire.resolve('monaco-editor/esm/vs/language/typescript/ts.worker.js');
const original = fs.readFileSync(workerPath, 'utf8');
const loader = require('../packages/admin/config/loaders/monaco-typescript-libs.cjs');
const webpackRequire = createRequire(adminRequire.resolve('monaco-editor-webpack-plugin'));
const webpack = webpackRequire('webpack');
// Resolve the existing minimizer's declared source-map dependency, without
// relying on pnpm hoisting or adding another build/runtime dependency.
const esbuildRequire = createRequire(adminRequire.resolve('@umijs/plugin-esbuild'));
const minifierRequire = createRequire(esbuildRequire.resolve('esbuild-loader'));
const sourcesRequire = createRequire(minifierRequire.resolve('webpack-sources'));
const { SourceMapConsumer } = sourcesRequire('source-map');
const hash = (value) => createHash('sha256').update(value).digest('hex');

// Independently obtain the actual upstream library values for a full round trip.
const ast = ts.createSourceFile(workerPath, original, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
const libraryStatements = ast.statements.filter((statement) => {
  if (!ts.isExpressionStatement(statement) || !ts.isBinaryExpression(statement.expression)) return false;
  const left = statement.expression.left;
  return ts.isElementAccessExpression(left) && ts.isIdentifier(left.expression)
    && left.expression.text === 'libFileMap';
});
const expected = Object.fromEntries(libraryStatements.map(({ expression }) => [
  expression.left.argumentExpression.text, expression.right.text,
]));
const names = Object.keys(expected);

function runLoader(source, options = {}) {
  const assets = [];
  let result;
  loader.call({
    resourcePath: workerPath,
    sourceMap: Boolean(options.sourceMap),
    _compiler: { webpack },
    emitFile(name, content, map, info) { assets.push({ name, content, info }); },
    callback(error, output, map) { if (error) throw error; result = { output, map }; },
  }, source, options.inputMap);
  assert.equal(assets.length, 1);
  return { ...result, asset: assets[0] };
}

function fixture() {
  return `/*! Fixture copyright notice. */\nvar before = true;\nvar libFileMap = {};\n${names.map((name) => `libFileMap[${JSON.stringify(name)}] = ${JSON.stringify(`${name}\nquotes: " ' \\ 雪`)};`).join('\n')}\nself.result = libFileMap;\nvar after = true;\n`;
}

function runtime(result, workerUrl, publicPath, onImport) {
  const requests = [];
  const context = vm.createContext({ URL, location: new URL(workerUrl), __webpack_public_path__: publicPath });
  vm.runInContext('self = globalThis;', context);
  context.importScripts = (url) => {
    requests.push(url);
    if (onImport) return onImport(context, result.asset);
    vm.runInContext(result.asset.content, context);
  };
  return { context, requests, execute: () => vm.runInContext(result.output, context) };
}

test('all 62 upstream standard libraries retain their text, licenses and object semantics', () => {
  assert.equal(names.length, 62);
  const result = runLoader(original);
  assert.match(result.asset.name, /^ts-libs\.[a-f0-9]{64}\.js$/);
  assert.equal(result.asset.name, `ts-libs.${hash(result.asset.content)}.js`);
  assert.ok(result.asset.info.immutable);
  assert.ok(gzipSync(result.asset.content).length < 1024 * 1024);
  const context = vm.createContext({});
  vm.runInContext('self = globalThis;', context);
  vm.runInContext(result.asset.content, context);
  const key = Object.keys(context).find((name) => name.startsWith('__zweiblogMonacoTypeScriptLibs_'));
  const files = context[key].files;
  assert.deepEqual(Object.keys(files).sort(), names.slice().sort());
  for (const name of names) {
    assert.equal(files[name], expected[name], name);
    assert.equal(hash(files[name]), hash(expected[name]), `${name} SHA-256`);
    assert.match(files[name], /Copyright \(c\) Microsoft Corporation/);
  }
  assert.equal(vm.runInContext(`Object.getPrototypeOf(self[${JSON.stringify(key)}].files) === Object.prototype`, context), true);
  // The adapter replaces only the pure data section, leaving every worker method.
  const start = original.lastIndexOf('var libFileMap = {};', libraryStatements[0].pos);
  const end = libraryStatements.at(-1).end;
  assert.ok(start >= 0);
  assert.equal(result.output.slice(0, start), original.slice(0, start));
  assert.ok(result.output.endsWith(original.slice(end)));
  assert.ok(result.asset.content.includes(original.slice(start, end)));
  assert.equal(result.map, undefined);
});

test('development, production, CDN and blob workers resolve the same data resource correctly', () => {
  const result = runLoader(fixture());
  for (const [workerUrl, publicPath, originAndPath] of [
    ['https://blog.example/admin/ts.worker.js', '/admin/', 'https://blog.example/admin/'],
    ['http://localhost:3002/ts.worker.js', '/', 'http://localhost:3002/'],
    ['blob:https://blog.example/opaque', '/admin/', 'https://blog.example/admin/'],
    ['blob:http://localhost:3002/opaque', '/', 'http://localhost:3002/'],
    ['blob:https://blog.example/opaque', 'https://cdn.example/editor/', 'https://cdn.example/editor/'],
    ['blob:https://blog.example/opaque', '//cdn.example/editor/', 'https://cdn.example/editor/'],
  ]) {
    const probe = runtime(result, workerUrl, publicPath);
    probe.execute();
    assert.deepEqual(probe.requests, [originAndPath + result.asset.name]);
    assert.deepEqual(Object.keys(probe.context.result).sort(), names.slice().sort());
    assert.equal(vm.runInContext('Object.getPrototypeOf(result) === Object.prototype', probe.context), true);
    assert.equal(Object.keys(probe.context).some((name) => name.startsWith('__zweiblogMonacoTypeScriptLibs_')), false);
  }
});

test('missing, incomplete and incompatible assets fail clearly and release the temporary registry', () => {
  const result = runLoader(fixture());
  for (const corrupt of [
    () => { throw new Error('404 fixture'); },
    () => {},
    (context, asset) => {
      vm.runInContext(asset.content, context);
      const key = Object.keys(context).find((name) => name.startsWith('__zweiblogMonacoTypeScriptLibs_'));
      delete context[key].files['lib.dom.d.ts'];
    },
    (context, asset) => {
      vm.runInContext(asset.content, context);
      const key = Object.keys(context).find((name) => name.startsWith('__zweiblogMonacoTypeScriptLibs_'));
      context[key].files['lib.dom.d.ts'] = 42;
    },
    (context, asset) => {
      vm.runInContext(asset.content, context);
      const key = Object.keys(context).find((name) => name.startsWith('__zweiblogMonacoTypeScriptLibs_'));
      context[key].digest = 'wrong version';
    },
  ]) {
    const probe = runtime(result, 'blob:https://blog.example/opaque', '/admin/', corrupt);
    assert.throws(probe.execute, /Monaco TypeScript standard libraries could not be loaded/);
    assert.equal(Object.keys(probe.context).some((name) => name.startsWith('__zweiblogMonacoTypeScriptLibs_')), false);
    assert.equal(probe.context.result, undefined);
  }
  const occupied = runtime(result, 'https://blog.example/admin/ts.worker.js', '/admin/');
  vm.runInContext(result.asset.content, occupied.context);
  assert.throws(occupied.execute, /registry is already occupied/);
  assert.deepEqual(occupied.requests, []);
});

test('upstream structural drift, dynamic values and duplicate entries stop the build', () => {
  const source = fixture();
  const first = `libFileMap[${JSON.stringify(names[0])}]`;
  for (const changed of [
    source.replace('var libFileMap = {};', 'export var libFileMap = {};'),
    source.replace('var libFileMap = {};', 'var libFileMap = Object.create(null);'),
    source.replace('var libFileMap = {};', 'var libFileMap = {}, other = sideEffect();'),
    source.replace(`${first} =`, `${first} +=`),
    source.replace(`${first} =`, 'libFileMap[dynamicName] ='),
    source.replace(/libFileMap\["lib.d.ts"\] = [^;]+;/, `${first} = sideEffect();`),
    source.replace(/libFileMap\["lib.d.ts"\] = [^;]+;/, `${first} = \`dynamic \${sideEffect()}\`;`),
    source.replace(`libFileMap[${JSON.stringify(names[1])}]`, first),
    source.replace(`${first} =`, `sideEffect();\n${first} =`),
    source + '\nlibFileMap["lib.extra.d.ts"] = "later";',
    source + '\nvar libFileMap = {};',
  ]) assert.throws(() => runLoader(changed), /Monaco TypeScript library extraction:/);
});

test('source maps retain original locations and upstream source content after extraction', () => {
  const source = fixture();
  for (const inputMap of [undefined, new webpack.sources.OriginalSource(source, 'upstream/ts.worker.js').map()]) {
    const result = runLoader(source, { sourceMap: true, inputMap });
    assert.ok(result.map);
    assert.ok(result.map.sourcesContent.includes(source));
    const generatedLine = result.output.slice(0, result.output.indexOf('var after =')).split('\n').length;
    const originalLine = source.slice(0, source.indexOf('var after =')).split('\n').length;
    const consumer = new SourceMapConsumer(result.map);
    const position = consumer.originalPositionFor({ line: generatedLine, column: 0 });
    assert.equal(position.line, originalLine);
    assert.equal(position.source, inputMap ? 'upstream/ts.worker.js' : workerPath);
    if (consumer.destroy) consumer.destroy();
  }
});

test('the Umi adapter only excludes complete hashed data assets and preserves previous exclusions', () => {
  const source = fs.readFileSync(path.join(root, 'packages/admin/config/plugins/monaco-library-assets.js'), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports });
  let modifier;
  module.exports.default({ modifyBundleConfig(value) { modifier = value; } });
  assert.equal(modifier.stage, 100);
  class ESBuildMinifyPlugin { constructor(exclude) { this.options = { exclude }; } }
  for (const previous of [undefined, /existing\.js$/, [/existing\.js$/]]) {
    for (const env of ['production', 'development']) {
      const esbuild = new ESBuildMinifyPlugin(previous);
      const config = { optimization: { minimize: true, minimizer: [esbuild] } };
      assert.equal(modifier.fn(config, { env }), config);
      const exclusions = esbuild.options.exclude;
      if (previous) assert.equal(exclusions[0], Array.isArray(previous) ? previous[0] : previous);
      const pattern = exclusions.at(-1);
      assert.ok(pattern.test(`ts-libs.${'a'.repeat(64)}.js`));
      for (const name of ['ts.worker.js', 'umi.js', 'css.worker.js', 'ts-libs.short.js']) assert.equal(pattern.test(name), false);
    }
  }
  assert.throws(() => modifier.fn({ optimization: { minimize: true, minimizer: [] } }, { env: 'production' }), /require the configured Umi esbuild minimizer/);
  assert.doesNotThrow(() => modifier.fn({ optimization: { minimize: false } }, { env: 'development' }));
});
