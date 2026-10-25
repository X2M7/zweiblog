import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { ArticleProvider } from '../article/article.provider';
import { Feed } from 'feed';
import { MetaProvider } from '../meta/meta.provider';
import fs from 'fs';
import path from 'path';
import { config } from 'src/config';
import { MarkdownProvider } from '../markdown/markdown.provider';
import { washUrl } from 'src/utils/washUrl';

@Injectable()
export class RssProvider implements OnModuleInit {
  logger = new Logger(RssProvider.name);
  timer = null;
  private generation = 0;
  private maintenanceHolds = 0;
  private readonly feedFiles = ['feed.json', 'feed.xml', 'atom.xml'];
  constructor(
    private readonly articleProvider: ArticleProvider,
    private readonly metaProvider: MetaProvider,
    private readonly markdownProvider: MarkdownProvider,
  ) {}

  onModuleInit() {
    // Previously generated feeds may predate the current privacy policy.
    // Revoke them before Nest starts listening; failure must abort startup.
    this.invalidateRssFeed();
  }

  private removePublishedFeeds() {
    for (const filename of this.feedFiles) {
      fs.rmSync(path.join(config.staticPath, 'rss', filename), { force: true });
    }
  }

  invalidateRssFeed() {
    ++this.generation;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.removePublishedFeeds();
    return this.generation;
  }

  pauseRssFeed(): (info?: string) => Promise<void> {
    this.invalidateRssFeed();
    ++this.maintenanceHolds;
    let released = false;
    return async (info?: string) => {
      if (released) return;
      released = true;
      --this.maintenanceHolds;
      if (this.maintenanceHolds === 0) await this.generateRssFeed(info);
    };
  }

  async generateRssFeed(info?: string, delay?: number) {
    // Privacy changes revoke existing exports immediately, including during
    // the debounce period or when the next database lookup fails.
    const generation = this.invalidateRssFeed();
    // Maintenance may span several scheduled refreshes. Only the last
    // release may schedule publication of the resulting database state.
    if (this.maintenanceHolds > 0) return;
    // 生成 RSS 订阅需要遍历全部文章数据，所以防抖时间长一点吧。
    this.timer = setTimeout(
      () => {
        this.timer = null;
        if (generation === this.generation) void this.generateRssFeedFn(info);
      },
      delay || 3 * 60 * 1000,
    );
  }

  async generateRssFeedFn(info?: string) {
    if (this.maintenanceHolds > 0) return;
    const generation = ++this.generation;
    this.logger.log(info + '重新生成 RSS 订阅');
    try {
      this.removePublishedFeeds();
      const articles = await this.articleProvider.getAllForPublicFeed();
      const meta = await this.metaProvider.getAll();
      const email = process.env.EMAIL;
      const author = {
        name: meta.siteInfo.author,
        email,
        link: meta.siteInfo.baseUrl,
      };
      const siteUrl = washUrl(meta.siteInfo.baseUrl);
      const favicon =
        meta.siteInfo.favicon ||
        meta.siteInfo.siteLogo ||
        meta.siteInfo.authorLogo ||
        `${siteUrl}logo.svg`;
      const siteLogo =
        meta.siteInfo.siteLogo ||
        meta.siteInfo.authorLogo ||
        meta.siteInfo.favicon ||
        `${siteUrl}logo.svg`;
      const date = new Date();
      const feed = new Feed({
        title: meta.siteInfo.siteName,
        description: meta.siteInfo.siteDesc,
        id: siteUrl,
        link: siteUrl,
        language: '	zh-cn',
        image: siteLogo,
        favicon: favicon,
        copyright: `All rights reserved ${date.getFullYear()}, ${meta.siteInfo.author}`,
        updated: date,
        generator: 'Feed for ZweiBlog',
        feedLinks: {
          rss2: `${siteUrl}rss/feed.xml`, // xml format
          json: `${siteUrl}rss/feed.json`, // json fromat
        },
        author,
      });
      for (const article of articles) {
        const content = article.private ? '此文章已加密' : article.content || '';
        const url = `${siteUrl}post/${article.pathname || article.id}`;
        const category = {
          name: article.category,
          domain: `${siteUrl}/category/${article.category}`,
        };
        const html = `<div class="markdown-body rss">
      <link rel="stylesheet" href="${siteUrl}markdown.css">
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.5.1/katex.min.css">
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.6.0/build/styles/default.min.css">
      ${this.markdownProvider
        .renderMarkdown(content)
        .replace(
          /<div class="mermaid">/g,
          `<div class="mermaid" style="background: #f3f3f3; padding: 8px;"> <p>Mermaid 图表 RSS 暂无法显示，具体请查看原文</p>`,
        )}</div>`;
        feed.addItem({
          title: article.title,
          id: url,
          link: url,
          description: this.markdownProvider.renderMarkdown(
            this.markdownProvider.getDescription(content),
          ),
          category: [category],
          content: html,
          author: [author],
          contributor: [author],
          date: new Date(article.createdAt),
          published: new Date(article.updatedAt || article.createdAt),
        });
      }
      const rssPath = path.join(config.staticPath, 'rss');

      // A newer mutation may have revoked this snapshot while the queries
      // above were pending. Never republish it over the newer generation.
      if (generation !== this.generation) return;
      fs.mkdirSync(rssPath, { recursive: true });
      fs.writeFileSync(path.join(rssPath, 'feed.json'), feed.json1());
      fs.writeFileSync(path.join(rssPath, 'feed.xml'), feed.rss2());
      fs.writeFileSync(path.join(rssPath, 'atom.xml'), feed.atom1());
    } catch (err) {
      if (generation === this.generation) this.removePublishedFeeds();
      this.logger.error('生成订阅源失败！');
      this.logger.error(JSON.stringify(err, null, 2));
    }
  }
}
