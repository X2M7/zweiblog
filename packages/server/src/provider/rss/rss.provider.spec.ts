import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from 'src/config';
import { ArticleProvider } from '../article/article.provider';
import { MarkdownProvider } from '../markdown/markdown.provider';
import { RssProvider } from './rss.provider';
import { ISRProvider } from '../isr/isr.provider';

const queryResult = (value: any) => {
  const query: any = { exec: jest.fn().mockResolvedValue(value) };
  query.sort = jest.fn(() => query);
  query.lean = jest.fn(() => query);
  return query;
};

const article = (id: number, category: string, isPrivate = false) => ({
  id,
  title: `文章 ${id}`,
  titleEn: `Article ${id}`,
  category,
  private: isPrivate,
  content: `正文标记-${id} <!-- more --> 正文后半-${id}`,
  contentEn: `English-body-marker-${id}`,
  summary: `摘要标记-${id}`,
  summaryEn: `English-summary-marker-${id}`,
  password: `password-marker-${id}`,
  createdAt: new Date('2026-01-01T00:00:00Z'),
});

const makeProvider = () => {
  const articles = [
    article(1, 'public'),
    article(2, 'public', true),
    { _doc: article(3, 'locked') },
    article(4, 'missing'),
    article(5, ''),
  ];
  const articleModel: any = { find: jest.fn(() => queryResult(articles)) };
  const categoryModel: any = {
    find: jest.fn(() =>
      queryResult([
        { name: 'public', private: false },
        { name: 'locked', private: true },
      ]),
    ),
  };
  const metaProvider: any = {
    getAll: jest.fn().mockResolvedValue({
      siteInfo: { author: 'Author', baseUrl: 'https://example.test', siteName: 'Blog' },
    }),
  };
  const articlesProvider = new ArticleProvider(
    articleModel,
    categoryModel,
    metaProvider,
    {} as any,
  );
  const provider = new RssProvider(articlesProvider, metaProvider, new MarkdownProvider());
  jest.spyOn(provider.logger, 'log').mockImplementation(() => undefined);
  jest.spyOn(provider.logger, 'error').mockImplementation(() => undefined);
  return { provider, articlesProvider, articleModel, categoryModel, metaProvider, articles };
};

const feedFiles = ['feed.json', 'feed.xml', 'atom.xml'];
const feedPath = (filename: string) => path.join(config.staticPath, 'rss', filename);

describe('RSS public content and cache revocation', () => {
  let originalStaticPath: string;
  let directory: string;

  beforeEach(() => {
    jest.useFakeTimers();
    originalStaticPath = config.staticPath;
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zweiblog-rss-privacy-'));
    config.staticPath = directory;
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
    config.staticPath = originalStaticPath;
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const seedOldFeeds = () => {
    fs.mkdirSync(path.join(config.staticPath, 'rss'), { recursive: true });
    for (const filename of feedFiles) fs.writeFileSync(feedPath(filename), 'old-private-body');
  };

  it('revokes persisted feeds during module initialization before the server starts', () => {
    const { provider } = makeProvider();
    seedOldFeeds();

    provider.onModuleInit();

    for (const filename of feedFiles) expect(fs.existsSync(feedPath(filename))).toBe(false);
  });

  it('refuses startup if persisted feeds cannot be revoked', () => {
    const { provider } = makeProvider();
    jest.spyOn(fs, 'rmSync').mockImplementation(() => {
      throw new Error('permission denied');
    });

    expect(() => provider.onModuleInit()).toThrow('permission denied');
  });

  it('redacts both languages and summaries before protected records leave ArticleProvider', async () => {
    const { articlesProvider, articleModel, categoryModel, articles } = makeProvider();

    const result = await articlesProvider.getAllForPublicFeed();

    for (const protectedId of [2, 3, 4]) {
      const protectedArticle = result.find((entry) => entry.id === protectedId);
      expect(protectedArticle).toMatchObject({ private: true });
      for (const field of ['content', 'contentEn', 'summary', 'summaryEn', 'password']) {
        expect(protectedArticle).not.toHaveProperty(field);
      }
    }
    for (const publicId of [1, 5]) {
      expect(result.find((entry) => entry.id === publicId)).toMatchObject({
        content: article(publicId, '').content,
        contentEn: article(publicId, '').contentEn,
      });
    }
    expect(result.every((entry) => !('password' in entry))).toBe(true);
    expect((articles[2] as any)._doc.content).toBe(article(3, '').content);
    expect(categoryModel.find).toHaveBeenCalledTimes(1);
    expect(articleModel.find.mock.calls[0][0].$and).toEqual([
      { $or: [{ deleted: false }, { deleted: { $exists: false } }] },
      { $or: [{ hidden: false }, { hidden: { $exists: false } }] },
    ]);
  });

  it('never publishes protected bodies, summaries, or passwords in JSON, RSS, or Atom', async () => {
    const { provider } = makeProvider();

    await provider.generateRssFeedFn();

    for (const filename of feedFiles) {
      const output = fs.readFileSync(feedPath(filename), 'utf8');
      expect(output).toContain('正文标记-1');
      expect(output).toContain('正文标记-5');
      expect(output).toContain('此文章已加密');
      for (const id of [2, 3, 4]) {
        for (const marker of [
          '正文标记',
          '正文后半',
          'English-body-marker',
          '摘要标记',
          'English-summary-marker',
          'password-marker',
        ]) {
          expect(output).not.toContain(`${marker}-${id}`);
        }
      }
    }
    const feed = JSON.parse(fs.readFileSync(feedPath('feed.json'), 'utf8'));
    expect(feed.items.find((item: any) => item.id.endsWith('/3')).summary).toContain(
      '此文章已加密',
    );
  });

  it.each(['article', 'category', 'metadata'])(
    'removes old feeds when the %s lookup fails',
    async (lookup) => {
      const { provider, articleModel, categoryModel, metaProvider } = makeProvider();
      seedOldFeeds();
      const rejected = queryResult([]);
      rejected.exec.mockRejectedValue(new Error('lookup failed'));
      if (lookup === 'article') articleModel.find.mockReturnValue(rejected);
      if (lookup === 'category') categoryModel.find.mockReturnValue(rejected);
      if (lookup === 'metadata') metaProvider.getAll.mockRejectedValue(new Error('lookup failed'));

      await provider.generateRssFeedFn();

      for (const filename of feedFiles) expect(fs.existsSync(feedPath(filename))).toBe(false);
    },
  );

  it('revokes old files immediately while the next rebuild is still debounced', async () => {
    const { provider } = makeProvider();
    seedOldFeeds();

    await provider.generateRssFeed('privacy changed', 60_000);

    for (const filename of feedFiles) expect(fs.existsSync(feedPath(filename))).toBe(false);
  });

  it('cancels a scheduled rebuild when backup import revokes feeds without scheduling', async () => {
    const { provider } = makeProvider();
    const generate = jest.spyOn(provider, 'generateRssFeedFn').mockResolvedValue(undefined);
    await provider.generateRssFeed('pending edit', 1000);

    provider.invalidateRssFeed();
    jest.advanceTimersByTime(180_000);

    expect(generate).not.toHaveBeenCalled();
  });

  it('keeps feeds revoked through cron and direct refreshes until the last maintenance hold releases', async () => {
    const { provider, articleModel } = makeProvider();
    const generate = jest.spyOn(provider, 'generateRssFeedFn');
    const isrProvider = new ISRProvider(
      {} as any,
      provider,
      { generateSiteMap: jest.fn() } as any,
      {} as any,
    );
    jest.spyOn(isrProvider, 'activeWithRetry').mockResolvedValue(undefined);
    seedOldFeeds();
    const releaseOuter = provider.pauseRssFeed();
    const releaseInner = provider.pauseRssFeed();

    await isrProvider.activeAll('scheduled during backup');
    await provider.generateRssFeedFn('direct refresh during backup');
    jest.advanceTimersByTime(3 * 60 * 1000);
    expect(articleModel.find).not.toHaveBeenCalled();
    for (const filename of feedFiles) expect(fs.existsSync(feedPath(filename))).toBe(false);

    await releaseOuter();
    await releaseOuter(); // Releasing one handle twice must not release another hold.
    await provider.generateRssFeed('edit during nested maintenance', 1);
    jest.advanceTimersByTime(3 * 60 * 1000);
    expect(articleModel.find).not.toHaveBeenCalled();
    for (const filename of feedFiles) expect(fs.existsSync(feedPath(filename))).toBe(false);

    await releaseInner('backup finished');
    jest.advanceTimersByTime(3 * 60 * 1000);
    await generate.mock.results[generate.mock.results.length - 1].value;
    expect(articleModel.find).toHaveBeenCalledTimes(1);
    for (const filename of feedFiles) {
      expect(fs.readFileSync(feedPath(filename), 'utf8')).toContain('正文标记-1');
    }
  });

  it('does not republish an in-flight snapshot after a newer privacy change', async () => {
    const { provider, articleModel } = makeProvider();
    let finish: (value: any) => void;
    const pending = queryResult([]);
    pending.exec.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    articleModel.find.mockReturnValueOnce(pending);
    const oldGeneration = provider.generateRssFeedFn();

    await provider.generateRssFeed('privacy changed', 60_000);
    finish([article(1, 'public')]);
    await oldGeneration;

    for (const filename of feedFiles) expect(fs.existsSync(feedPath(filename))).toBe(false);
  });

  it('does not remove a newer feed when an older generation fails later', async () => {
    const { provider, articleModel } = makeProvider();
    let fail: (error: Error) => void;
    const pending = queryResult([]);
    pending.exec.mockImplementation(
      () =>
        new Promise((_, reject) => {
          fail = reject;
        }),
    );
    articleModel.find.mockReturnValueOnce(pending);
    const oldGeneration = provider.generateRssFeedFn();
    await provider.generateRssFeedFn();

    fail(new Error('older query failed'));
    await oldGeneration;

    for (const filename of feedFiles) {
      expect(fs.readFileSync(feedPath(filename), 'utf8')).toContain('正文标记-1');
    }
  });
});
