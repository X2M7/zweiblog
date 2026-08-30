#!/usr/bin/env node

const { lstatSync, readFileSync } = require('fs');
const { MongoClient } = require('mongodb');

const fallbackUri = 'mongodb://mongo:27017/zweiBlog?authSource=admin';

const validateMongoUri = (value) => {
  if (!value || value.length > 8192 || /[\u0000-\u0020\u007f]/.test(value)) {
    throw new Error('MongoDB connection URL is invalid');
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('MongoDB connection URL is invalid');
  }
  if (!['mongodb:', 'mongodb+srv:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error('MongoDB connection URL must use mongodb:// or mongodb+srv://');
  }
  return value;
};

const readMongoUriFromEnvironment = () => {
  const direct = process.env.ZWEI_BLOG_DATABASE_URL?.trim();
  const file = process.env.ZWEI_BLOG_DATABASE_URL_FILE?.trim();
  if (direct && file) {
    throw new Error('Set only one of ZWEI_BLOG_DATABASE_URL and ZWEI_BLOG_DATABASE_URL_FILE');
  }
  if (direct) return validateMongoUri(direct);
  if (!file) return fallbackUri;

  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > 8192) {
    throw new Error('MongoDB connection URL secret must be a small regular file');
  }
  return validateMongoUri(readFileSync(file, 'utf8').replace(/[\r\n]+$/, ''));
};

const readString = (prompt) => {
  process.stdout.write(prompt);
  return new Promise((resolve) => {
    process.stdin.once('data', (data) => resolve(data.toString().trim()));
  });
};

const parseDatabaseFromUri = (uri) => {
  const pathname = new URL(uri).pathname.slice(1);
  const database = decodeURIComponent(pathname);
  if (!database || database.includes('/')) {
    throw new Error('MongoDB connection URL must contain one database name');
  }
  return database;
};

const describeUri = (uri) => {
  const parsed = new URL(uri);
  const port = parsed.port ? `:${parsed.port}` : '';
  return `${parsed.protocol}//${parsed.hostname}${port}/${parseDatabaseFromUri(uri)}`;
};

const resetHttps = async (client, databaseName) => {
  const database = client.db(databaseName);
  const result = await database.collection('settings').deleteOne({ type: 'https' });
  console.log(`HTTPS 设置已重置，删除记录数：${result.deletedCount}`);
  console.log('重启 ZweiBlog 后生效。');
};

const main = async () => {
  const uriFromUser = await readString(
    '输入 MongoDB 连接 URL（使用当前容器配置请直接按回车）：\n  ',
  );
  const uriToUse = validateMongoUri(uriFromUser || readMongoUriFromEnvironment());
  const databaseName = parseDatabaseFromUri(uriToUse);

  // Never print credentials. This command may be captured in support logs.
  console.log('MongoDB 目标：', describeUri(uriToUse));
  console.log('正在连接数据库……');

  const client = new MongoClient(uriToUse, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    await resetHttps(client, databaseName);
  } catch (error) {
    console.error('重置 HTTPS 设置失败：', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await client.close().catch(() => undefined);
  }
};

main().catch((error) => {
  console.error('重置 HTTPS 设置失败：', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
