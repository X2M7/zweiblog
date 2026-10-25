const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

// Run against the workspace by default, or against a real production deploy:
// ZWEIBLOG_PICGO_SERVER_DIR=/tmp/server-prod node --test scripts/picgo-runtime.test.cjs
// Keep the runtime exercise in a fresh process so no cached/hoisted development
// dependency can hide a PicGo import of the removed glob dependency chain.
async function exercisePicGo(serverDirectory, temporaryDirectory) {
  const Module = require('node:module');
  const forbiddenLoads = [];
  const forbiddenPackage = /(?:^|[/\\])(?:globby|micromatch|braces)(?:[/\\]|$)/;
  const originalLoad = Module._load;
  Module._load = function (specifier, parent, isMain) {
    if (
      forbiddenPackage.test(specifier) ||
      forbiddenPackage.test(Module._resolveFilename(specifier, parent, isMain))
    ) {
      forbiddenLoads.push(specifier);
      throw new Error(`Forbidden PicGo runtime dependency: ${specifier}`);
    }
    return originalLoad.call(this, specifier, parent, isMain);
  };

  // Fail even if an optional dependency loader catches the rejected import.
  // Verify the guard itself before recording actual PicGo activity.
  for (const name of ['globby', 'micromatch', 'braces']) {
    assert.throws(() => require(name), /Forbidden PicGo runtime dependency/);
  }
  forbiddenLoads.length = 0;

  const networkAttempts = [];
  const denyNetwork = (operation) => () => {
    networkAttempts.push(operation);
    throw new Error(`Network is disabled in the PicGo runtime test: ${operation}`);
  };
  require('node:net').Socket.prototype.connect = denyNetwork('net.connect');
  require('node:tls').connect = denyNetwork('tls.connect');
  require('node:dgram').createSocket = denyNetwork('dgram.createSocket');
  require('node:dns').lookup = denyNetwork('dns.lookup');
  // PicGo receives an explicit config path. Also keep any library fallback
  // through os.homedir() inside the disposable child-process directory.
  require('node:os').homedir = () => join(temporaryDirectory, 'home');
  globalThis.fetch = denyNetwork('fetch');
  Module.syncBuiltinESMExports();

  const configDirectory = join(temporaryDirectory, 'picgo-config');
  const configPath = join(configDirectory, 'config.json');
  const pluginName = 'picgo-plugin-zweiblog-local-fixture';
  const uploaderName = 'zweiblog-local-fixture';
  const pluginDirectory = join(configDirectory, 'node_modules', pluginName);
  fs.mkdirSync(pluginDirectory, { recursive: true });
  fs.mkdirSync(join(configDirectory, 'uploaded'));
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      silent: true,
      debug: true,
      picBed: { current: uploaderName, uploader: uploaderName, transformer: 'path' },
    }),
  );
  fs.writeFileSync(
    join(configDirectory, 'package.json'),
    JSON.stringify({ private: true, dependencies: { [pluginName]: '1.0.0' } }),
  );
  fs.writeFileSync(
    join(pluginDirectory, 'package.json'),
    JSON.stringify({ name: pluginName, version: '1.0.0', main: 'index.cjs' }),
  );
  fs.writeFileSync(
    join(pluginDirectory, 'index.cjs'),
    `const fs = require('node:fs');
const path = require('node:path');
module.exports = () => {
  const calls = [];
  return {
    calls,
    register(ctx) {
      ctx.helper.uploader.register('${uploaderName}', {
        async handle(upload) {
          for (const image of upload.output) {
            if (!Buffer.isBuffer(image.buffer)) throw new Error('Missing transformed image buffer');
            calls.push({ fileName: image.fileName, size: image.buffer.length });
            fs.writeFileSync(path.join(upload.baseDir, 'uploaded', image.fileName), image.buffer);
            image.imgUrl = 'https://picgo-test.invalid/' + image.fileName;
          }
          return upload;
        }
      });
    }
  };
};
`,
  );

  // A real one-pixel PNG exercises the same path transformer used by saveFile.
  const fixture = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8i8AAAAASUVORK5CYII=',
    'base64',
  );
  const fixturePath = join(temporaryDirectory, 'fixture.png');
  fs.writeFileSync(fixturePath, fixture);
  assert.ok(fs.existsSync(join(serverDirectory, 'node_modules', 'picgo', 'package.json')));
  const serverRequire = createRequire(join(serverDirectory, 'package.json'));
  const { PicGo } = serverRequire('picgo');
  const picgo = new PicGo(configPath);
  assert.equal(picgo.configPath, configPath);
  assert.equal(picgo.baseDir, configDirectory);
  assert.ok(picgo.pluginLoader.hasPlugin(pluginName));
  assert.ok(picgo.pluginLoader.getList().includes(pluginName));
  assert.ok(picgo.helper.uploader.get(uploaderName));

  picgo.setConfig({ 'picBed.current': uploaderName, 'picBed.uploader': uploaderName });
  picgo.saveConfig({ 'settings.zweiblogRuntimeTest': true });
  assert.equal(picgo.getConfig('picBed.current'), uploaderName);
  assert.equal(JSON.parse(fs.readFileSync(configPath, 'utf8')).settings.zweiblogRuntimeTest, true);

  const failures = [];
  picgo.on('failed', (error) => failures.push(String(error)));
  const output = await picgo.upload([fixturePath]);
  assert.deepEqual(failures, []);
  assert.ok(Array.isArray(output));
  assert.equal(output.length, 1);
  assert.equal(output[0].imgUrl, 'https://picgo-test.invalid/fixture.png');
  assert.equal(output[0].type, uploaderName);
  assert.equal(output[0].contentType, 'image/png');
  assert.equal(output[0].width, 1);
  assert.equal(output[0].height, 1);
  assert.equal(output[0].size, fixture.length);
  assert.deepEqual(picgo.pluginLoader.getPlugin(pluginName).calls, [
    { fileName: 'fixture.png', size: fixture.length },
  ]);
  assert.deepEqual(fs.readFileSync(join(configDirectory, 'uploaded', 'fixture.png')), fixture);
  assert.equal(picgo.server.isListening(), false);
  assert.deepEqual(forbiddenLoads, []);
  assert.deepEqual(networkAttempts, []);
  assert.equal(
    Object.keys(require.cache).some((file) => forbiddenPackage.test(file)),
    false,
  );
  process.stdout.write(
    `PICGO_RUNTIME_RESULT=${JSON.stringify({ version: picgo.VERSION, uploaded: 1 })}\n`,
  );
}

if (process.argv[2] === '--picgo-runtime-child') {
  exercisePicGo(process.argv[3], process.argv[4]).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
} else {
  const { spawnSync } = require('node:child_process');
  const { test } = require('node:test');
  test('PicGo initializes and uploads through a local plugin without glob dependencies', (t) => {
    const temporaryDirectory = fs.mkdtempSync(join(tmpdir(), 'zweiblog-picgo-runtime-'));
    t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
    const serverDirectory = resolve(
      process.env.ZWEIBLOG_PICGO_SERVER_DIR || join(__dirname, '..', 'packages', 'server'),
    );
    const result = spawnSync(
      process.execPath,
      [__filename, '--picgo-runtime-child', serverDirectory, temporaryDirectory],
      {
        cwd: temporaryDirectory,
        encoding: 'utf8',
        timeout: 30_000,
        env: {
          ...process.env,
          NODE_OPTIONS: '',
          NODE_PATH: '',
          NODE_COMPILE_CACHE: '',
          DOTENV_CONFIG_PATH: join(temporaryDirectory, '.env'),
          DOTENV_CONFIG_QUIET: 'true',
        },
      },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 0, `PicGo runtime failed:\n${result.stdout}\n${result.stderr}`);
    const summary = result.stdout
      .split('\n')
      .find((line) => line.startsWith('PICGO_RUNTIME_RESULT='));
    assert.ok(summary, 'Child process must finish the real upload assertions');
    t.diagnostic(summary.slice('PICGO_RUNTIME_RESULT='.length));
  });
}
