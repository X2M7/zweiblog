#! /usr/bin/env node
const { spawn } = require('child_process');
const { writeFileSync } = require('fs');
const { join } = require('path');
let logPath = `/var/log/`;
if (process.platform === 'win32') {
  logPath = join(__dirname, '../log');
}

const logPathEnv = process.env.ZWEI_BLOG_LOG;
if (logPathEnv) {
  logPath = logPathEnv;
}

const printLog = (string, isError = false) => {
  const logName = `zweiblog-${isError ? 'stderr' : 'stdout'}.log`;
  const logNameNormal = `zweiblog-stdio.log`;
  writeFileSync(join(logPath, logName), string, { flag: 'a' });
  writeFileSync(join(logPath, logNameNormal), string, { flag: 'a' });
};

const ctx = spawn('node', ['main.js'], {
  cwd: '/app/server',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
  },
});
let stopping = false;
ctx.on('exit', (code, signal) => {
  process.stderr.write(`[zweiblog] 已停止 (${signal || code || 0})\n`);
  process.exit(stopping ? 0 : code ?? 1);
});
ctx.stdout.on('data', (data) => {
  printLog(data.toString(), false);
  process.stdout.write(data.toString());
});
ctx.stderr.on('data', (data) => {
  printLog(data.toString(), true);
  process.stderr.write(data.toString());
});
const shutdown = (signal) => {
  if (stopping) return;
  stopping = true;
  console.log(`检测到 ${signal} 关闭信号，正在优雅退出！`);

  // The Nest application already handles SIGINT and uses it to stop the
  // detached website process. Translate Docker's SIGTERM accordingly.
  if (ctx.exitCode === null && ctx.signalCode === null) {
    ctx.kill('SIGINT');
  } else {
    process.exit(0);
  }

  setTimeout(() => {
    if (ctx.exitCode === null && ctx.signalCode === null) ctx.kill('SIGKILL');
  }, 25000).unref();
};

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
