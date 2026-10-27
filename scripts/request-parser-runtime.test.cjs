// Run with: node --test scripts/request-parser-runtime.test.cjs
// Each probe owns a disposable loopback server in a child process. An uncaught
// decompressor error must fail the test without terminating the test runner.
// Regression: https://github.com/expressjs/body-parser/security/advisories/GHSA-27r3-jxmh-p828
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const http = require('node:http');
const { createRequire } = require('node:module');
const path = require('node:path');
const zlib = require('node:zlib');

const expectedBody = { message: 'parser regression 中文', count: 1 };
const jsonBody = Buffer.from(JSON.stringify(expectedBody));

async function probe(scenario) {
  // Follow the server's actual Express dependency, including its body-parser.
  const serverRequire = createRequire(path.join(__dirname, '../packages/server/package.json'));
  const express = serverRequire('express');
  const expressRequire = createRequire(serverRequire.resolve('express/package.json'));
  console.log(JSON.stringify({
    node: process.version,
    express: serverRequire('express/package.json').version,
    bodyParser: expressRequire('body-parser/package.json').version,
    scenario,
  }));

  const app = express();
  let finishTrailingRequest;
  app.use(express.json({ limit: '256kb' }));
  app.post('/echo', (request, response) => {
    if (finishTrailingRequest) {
      // Wait for the entire HTTP body, so successful parsing alone cannot mask
      // a decompressor crash or a stalled request after the valid frame ends.
      request.once('end', () => response.json(request.body));
      const finish = finishTrailingRequest;
      finishTrailingRequest = undefined;
      finish();
    } else {
      response.json(request.body);
    }
  });
  app.use((error, _request, response, _next) => {
    response.status(error.status || 500).json({ error: error.type || 'parse.failed' });
  });
  const server = http.createServer(app);
  const clients = new Set();
  const sockets = new Set();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  const watchdog = setTimeout(() => {
    console.error('Request parser probe exceeded its time limit');
    process.exit(2);
  }, 7000);

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    function post(body, encoding, trailing) {
      return new Promise((resolve, reject) => {
        const request = http.request({
          host: '127.0.0.1',
          port: server.address().port,
          path: '/echo',
          method: 'POST',
          agent: false,
          headers: {
            'content-type': 'application/json',
            'content-length': body.length + (trailing?.length || 0),
            ...(encoding ? { 'content-encoding': encoding } : {}),
          },
        }, (response) => {
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.once('error', reject);
          response.once('end', () => {
            try {
              resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks)) });
            } catch (error) {
              reject(error);
            }
          });
        });
        clients.add(request);
        request.once('close', () => clients.delete(request));
        request.once('error', reject);
        request.setTimeout(2500, () => request.destroy(new Error('Loopback request timed out')));
        if (trailing) {
          // Deliver the final bytes only after the decoder has returned the
          // JSON value. This exercises stream teardown without timing sleeps.
          finishTrailingRequest = () => request.end(trailing);
          request.write(body);
        } else {
          request.end(body);
        }
      });
    }

    let result;
    if (scenario === 'json') {
      result = await post(jsonBody);
    } else if (scenario === 'gzip') {
      result = await post(zlib.gzipSync(jsonBody), 'gzip');
    } else if (scenario === 'trailing-deflate') {
      const firstFrame = Buffer.concat([zlib.deflateSync(jsonBody), Buffer.from([0])]);
      result = await post(firstFrame, 'deflate', Buffer.alloc(1024));
    } else if (scenario === 'trailing-gzip') {
      result = await post(Buffer.concat([
        zlib.gzipSync(jsonBody),
        Buffer.from([0]),
        Buffer.alloc(100 * 1024, 0x58),
      ]), 'gzip');
    } else if (scenario === 'invalid-gzip') {
      const invalid = await post(Buffer.from('invalid gzip data'), 'gzip');
      assert.equal(invalid.status, 400, 'Malformed compression must receive a client error');
      result = await post(jsonBody);
    } else {
      throw new Error(`Unknown probe scenario: ${scenario}`);
    }
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, expectedBody);
    // A fresh request confirms the worker is usable after each parser path.
    const next = await post(jsonBody);
    assert.equal(next.status, 200);
    assert.deepEqual(next.body, expectedBody);
  } finally {
    clearTimeout(watchdog);
    for (const request of clients) request.destroy();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
}

if (process.argv[2] === '--parser-probe') {
  probe(process.argv[3]).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
} else {
  const { test } = require('node:test');
  const cases = [
    ['json', 'accepts ordinary JSON'],
    ['gzip', 'accepts valid gzip-compressed JSON'],
    ['trailing-deflate', 'finishes a compressed frame with trailing bytes without crashing'],
    ['trailing-gzip', 'survives trailing bytes delivered after a completed gzip frame'],
    ['invalid-gzip', 'rejects malformed compressed JSON and keeps serving requests'],
  ];
  for (const [scenario, description] of cases) {
    test(description, () => {
      const result = spawnSync(process.execPath, [__filename, '--parser-probe', scenario], {
        encoding: 'utf8',
        timeout: 10000,
        killSignal: 'SIGKILL',
        maxBuffer: 128 * 1024,
      });
      assert.equal(result.error, undefined, result.error?.message);
      assert.equal(result.signal, null, `Probe terminated by ${result.signal}`);
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    });
  }
}
