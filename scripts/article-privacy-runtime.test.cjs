// Production Next HTTP regression for S03. Uses a disposable API and Next app;
// never reads or changes the preview/production database. Run with node.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

const website = path.resolve(__dirname, '../packages/website');
const nextCli = path.join(website, 'node_modules/next/dist/bin/next');
const tokens = ['S03_BODY_ZH', 'S03_BODY_EN', 'S03_SUMMARY_ZH', 'S03_SUMMARY_EN'];
let visibility = 'public';
let slug = 'old-slug';
let child;
let fixture;

function currentArticle() {
  const article = {
    id: 1,
    pathname: slug,
    title: 'S03_TITLE',
    titleEn: 'English',
    category: 'notes',
    tags: ['test'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    private: visibility !== 'public',
  };
  if (visibility === 'public') {
    [article.content, article.contentEn, article.summary, article.summaryEn] = tokens;
  }
  return article;
}

const api = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let data;
  let statusCode = 200;
  const missing = visibility === 'hidden' || visibility === 'deleted';
  if (url.pathname === '/api/public/meta') {
    data = {
      totalArticles: missing ? 0 : 1,
      totalWordCount: 0,
      tags: ['test'],
      meta: {
        categories: ['notes'],
        socials: [],
        siteInfo: {
          author: 'Fixture',
          authorDesc: '',
          authorLogo: '',
          favicon: '',
          siteName: 'Fixture',
          siteDesc: '',
        },
      },
    };
  } else if (url.pathname === '/api/public/article') {
    data = { articles: missing ? [] : [currentArticle()], total: missing ? 0 : 1 };
  } else {
    const id = decodeURIComponent(url.pathname.split('/').at(-1));
    if (missing || (id !== slug && Number(id) !== 1)) statusCode = 404;
    else data = { article: currentArticle() };
  }
  res.writeHead(statusCode, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ statusCode, data }));
});

async function write(relative, content) {
  const target = path.join(fixture, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
}

async function runNext(args, env) {
  const process = spawn(global.process.execPath, [nextCli, ...args], {
    cwd: fixture,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  process.stdout.pipe(global.process.stdout);
  process.stderr.pipe(global.process.stderr);
  return process;
}

async function check(base, url, { contains = false, status = 200, prefetch = false } = {}) {
  const response = await fetch(base + url, {
    redirect: 'manual',
    headers: prefetch ? { 'x-middleware-prefetch': '1' } : {},
  });
  const body = await response.text();
  assert.equal(response.status, status, `${url}: ${body.slice(0, 150)}`);
  assert.match(response.headers.get('cache-control') || '', /no-store/, url);
  for (const token of tokens) assert.equal(body.includes(token), contains, `${url}: ${token}`);
  if (status === 200 && !prefetch) {
    assert.equal(response.headers.get('x-middleware-cache'), 'no-cache', url);
  }
  return { response, body };
}

async function main() {
  fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'zweiblog-s03-'));
  api.listen(0, '127.0.0.1');
  await once(api, 'listening');
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
    ZWEI_BLOG_SERVER_URL: `http://127.0.0.1:${api.address().port}`,
    // Delayed ISR must not influence the privacy checks.
    ZWEI_BLOG_REVALIDATE: 'true',
    ZWEI_BLOG_REVALIDATE_TIME: '86400',
  };
  delete env.isBuild;
  await fs.symlink(path.join(website, 'node_modules'), path.join(fixture, 'node_modules'), 'dir');
  await write('package.json', JSON.stringify({ private: true }));
  await write(
    'next.config.js',
    'module.exports = { experimental: { cpus: 1 }, typescript: { ignoreBuildErrors: true }, eslint: { ignoreDuringBuilds: true } };',
  );
  // Use the application's actual request loaders and routing middleware. The
  // tiny view exposes all serialized props so hidden HTML/data is detectable.
  for (const file of [
    'utils/requestPageProps.ts',
    'utils/getPageProps.ts',
    'utils/getLayoutProps.ts',
    'utils/getArticlePath.ts',
    'utils/washArticles.ts',
    'utils/auth.ts',
    'utils/loadConfig.ts',
    'utils/encode.ts',
    'utils/articleLanguage.ts',
    'utils/siteLanguageRouting.ts',
    'api/getArticles.ts',
    'api/getAllData.ts',
    'middleware.ts',
  ])
    await write(file, await fs.readFile(path.join(website, file), 'utf8'));
  const view =
    'export default function Page(props) { return <pre>{JSON.stringify(props)}</pre>; }\n';
  for (const language of ['', 'en/']) {
    const prefix = language ? '../../../' : '../../';
    await write(
      `pages/${language}post/[id].tsx`,
      view +
        `import { getArticleServerSideProps } from '${prefix}utils/requestPageProps';\n` +
        `export async function getServerSideProps(ctx) { return getArticleServerSideProps(ctx, '${
          language ? 'en' : 'zh'
        }'); }`,
    );
    const rootPrefix = language ? '../../' : '../';
    await write(
      `pages/${language}index.tsx`,
      view +
        `import { preventPageCaching } from '${rootPrefix}utils/requestPageProps';\n` +
        `import { getIndexPageProps } from '${rootPrefix}utils/getPageProps';\n` +
        'export async function getServerSideProps(ctx) { preventPageCaching(ctx.res); return { props: await getIndexPageProps() }; }',
    );
  }
  child = await runNext(['build'], env);
  assert.equal((await once(child, 'exit'))[0], 0, 'Next fixture build');
  const buildId = (await fs.readFile(path.join(fixture, '.next/BUILD_ID'), 'utf8')).trim();
  child = await runNext(['start', '--hostname', '127.0.0.1', '-p', '0'], env);
  let output = '';
  const base = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Next startup timeout')), 30_000);
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match && output.includes('Ready in')) {
        clearTimeout(timeout);
        resolve(match[0]);
      }
    });
    child.once('exit', (code) => reject(new Error(`Next exited: ${code}`)));
  });
  const paths = [
    '/post/old-slug',
    '/post/old-slug?lang=en',
    '/en/post/old-slug',
    '/',
    '/?lang=en',
    '/en',
  ];
  const dataPaths = [
    `/_next/data/${buildId}/post/old-slug.json`,
    `/_next/data/${buildId}/en/post/old-slug.json`,
    `/_next/data/${buildId}/index.json`,
    `/_next/data/${buildId}/en.json`,
  ];
  for (const url of [...paths, ...dataPaths]) await check(base, url, { contains: true });
  for (const alias of ['001', '1.0', '1e0', '0x1'])
    await check(base, `/post/${alias}`, { status: 307 });
  for (const state of ['article-password', 'category-password', 'hidden', 'deleted']) {
    visibility = state;
    const missing = state === 'hidden' || state === 'deleted';
    for (const url of [...paths, ...dataPaths]) {
      await check(base, url, { status: missing && url.includes('/post/') ? 404 : 200 });
    }
    console.log(`PASS: ${state}, HTML and _next/data, Chinese and English`);
  }
  visibility = 'public';
  slug = 'current-slug';
  await check(base, '/post/old-slug', { status: 404 });
  await check(base, `/_next/data/${buildId}/post/old-slug.json`, { status: 404 });
  const redirect = await check(base, '/post/001?lang=en', { status: 307 });
  assert.equal(redirect.response.headers.get('location'), '/post/current-slug?lang=en');
  await check(base, '/post/current-slug?lang=en', { contains: true });
  await check(base, `/_next/data/${buildId}/post/current-slug.json`, { prefetch: true });
  console.log('PASS: changed slug, aliases, language redirect and SSR prefetch');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await once(child, 'exit');
    }
    api.closeAllConnections();
    await new Promise((resolve) => api.close(resolve));
    if (fixture) await fs.rm(fixture, { recursive: true, force: true });
  });
