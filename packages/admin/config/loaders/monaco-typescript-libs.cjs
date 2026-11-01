'use strict';

const { createHash } = require('node:crypto');
const ts = require('typescript');

const LIBRARY_COUNT = 62; // Monaco 0.34.1; changes require reviewing this adapter.
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function fail(message) {
  throw new Error(`Monaco TypeScript library extraction: ${message}`);
}

function isMapAccess(node) {
  return ts.isElementAccessExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === 'libFileMap';
}

function extractLibraryBlock(source, filename) {
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  if (ast.parseDiagnostics.length) fail('the upstream worker could not be parsed');

  const declarations = ast.statements.filter((statement) => ts.isVariableStatement(statement)
    && statement.declarationList.declarations.some((item) => ts.isIdentifier(item.name)
      && item.name.text === 'libFileMap'));
  if (declarations.length !== 1) fail('expected one top-level libFileMap declaration');
  const declaration = declarations[0];
  const entries = declaration.declarationList.declarations;
  if (declaration.modifiers?.length
    || (declaration.declarationList.flags & ts.NodeFlags.BlockScoped) !== 0 || entries.length !== 1
    || !entries[0].initializer || !ts.isObjectLiteralExpression(entries[0].initializer)
    || entries[0].initializer.properties.length !== 0) {
    fail('expected the original var libFileMap = {} initialization');
  }

  const start = declaration.getStart(ast);
  let end = declaration.end;
  const names = [];
  const seen = new Set();
  const first = ast.statements.indexOf(declaration) + 1;
  let cursor = first;
  for (; cursor < ast.statements.length; cursor += 1) {
    const statement = ast.statements[cursor];
    if (!ts.isExpressionStatement(statement) || !ts.isBinaryExpression(statement.expression)
      || !isMapAccess(statement.expression.left)) break;
    const assignment = statement.expression;
    const key = assignment.left.argumentExpression;
    const value = assignment.right;
    if (assignment.operatorToken.kind !== ts.SyntaxKind.EqualsToken
      || !key || !ts.isStringLiteral(key)
      || !/^lib(?:\.[a-z0-9]+)*\.d\.ts$/.test(key.text)
      || !(ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value))) {
      fail('library entries must be plain assignments of static string literals');
    }
    if (seen.has(key.text)) fail(`duplicate library ${key.text}`);
    seen.add(key.text);
    names.push(key.text);
    end = statement.end;
  }
  if (names.length !== LIBRARY_COUNT) {
    fail(`expected ${LIBRARY_COUNT} consecutive library entries, found ${names.length}`);
  }
  // A later assignment would otherwise silently escape the extracted data file.
  for (; cursor < ast.statements.length; cursor += 1) {
    const statement = ast.statements[cursor];
    if (ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression)
      && isMapAccess(statement.expression.left)) fail('library assignments are not contiguous');
  }
  const leadingComments = ts.getLeadingCommentRanges(source, 0) || [];
  const notices = leadingComments.map((range) => source.slice(range.pos, range.end)).join('\n');
  return { start, end, names, notices, text: source.slice(start, end) };
}

function makeBootstrap(assetName, registryKey, digest, names) {
  // The output public path is /admin/ in production and / in development.
  // A blob worker has an opaque href, but its origin still resolves these paths.
  // Absolute and protocol-relative CDN paths retain their configured origin.
  return `var libFileMap = (function () {
  var registryKey = ${JSON.stringify(registryKey)};
  if (Object.prototype.hasOwnProperty.call(self, registryKey)) {
    throw new Error('Monaco TypeScript standard-library registry is already occupied');
  }
  var assetPath = __webpack_public_path__ + ${JSON.stringify(assetName)};
  var baseUrl = self.location.protocol === 'blob:'
    ? self.location.origin + '/' : self.location.href;
  var assetUrl = new URL(assetPath, baseUrl).href;
  try {
    importScripts(assetUrl);
    var payload = self[registryKey];
    var names = ${JSON.stringify(names)};
    var files = payload && payload.files;
    if (!payload || payload.digest !== ${JSON.stringify(digest)} || !files
      || Object.getPrototypeOf(files) !== Object.prototype
      || Object.keys(files).length !== names.length
      || names.some(function (name) {
        return !Object.prototype.hasOwnProperty.call(files, name)
          || typeof files[name] !== 'string';
      })) {
      throw new Error('the library resource is missing, incomplete, or incompatible');
    }
    return files;
  } catch (error) {
    throw new Error('Monaco TypeScript standard libraries could not be loaded ('
      + assetUrl + '): ' + (error && error.message || String(error)));
  } finally {
    delete self[registryKey];
  }
})();`;
}

module.exports = function monacoTypeScriptLibraries(source, inputMap) {
  if (this.cacheable) this.cacheable();
  const block = extractLibraryBlock(source, this.resourcePath);
  const digest = sha256(block.text);
  const registryKey = `__zweiblogMonacoTypeScriptLibs_${digest}`;
  // Keep the upstream data block byte for byte, including its library notices.
  // The separate asset retains {} semantics and introduces no library filtering.
  const asset = `${block.notices}\n(function () {\n${block.text}\nself[${JSON.stringify(registryKey)}] = { digest: ${JSON.stringify(digest)}, files: libFileMap };\n})();\n`;
  const assetName = `ts-libs.${sha256(asset)}.js`;
  const replacement = makeBootstrap(assetName, registryKey, digest, block.names);
  let output = source.slice(0, block.start) + replacement + source.slice(block.end);
  let map;
  if (this.sourceMap) {
    const sources = this._compiler && this._compiler.webpack && this._compiler.webpack.sources;
    if (!sources) fail('webpack sources are required to preserve the requested source map');
    const original = inputMap
      ? new sources.SourceMapSource(source, this.resourcePath, inputMap)
      : new sources.OriginalSource(source, this.resourcePath);
    const replaced = new sources.ReplaceSource(original);
    replaced.replace(block.start, block.end - 1, replacement);
    ({ source: output, map } = replaced.sourceAndMap({ columns: true }));
  }
  // The local Umi plugin also excludes this already-generated pure-data file
  // from its legacy esbuild minimizer, which ignores the minimized asset flag.
  this.emitFile(assetName, asset, undefined, { immutable: true, minimized: true });
  this.callback(null, output, map);
};
