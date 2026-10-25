import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { config } from 'src/config';
import { PublicCustomPageController } from 'src/controller/customPage/customPage.controller';
import { CustomPageProvider } from 'src/provider/customPage/customPage.provider';
import { registerPublicStaticAssets } from './publicStaticAssets';

describe('public static roots and custom-page isolation', () => {
  let app: NestExpressApplication;
  let staticRoot: string;
  const originalStaticRoot = config.staticPath;
  const html = '<!doctype html><main>Isolated project</main>';

  beforeAll(async () => {
    staticRoot = mkdtempSync(join(tmpdir(), 'zweiblog-static-routes-'));
    for (const directory of [
      'customPage/site',
      '.zweiblog-custom-page-uploads',
      'tmp',
      'img',
      'rss',
      'sitemap',
      'export',
    ]) {
      mkdirSync(join(staticRoot, directory), { recursive: true });
    }
    writeFileSync(join(staticRoot, 'customPage/site/index.html'), html);
    writeFileSync(join(staticRoot, 'tmp/private.txt'), 'PRIVATE-STAGING');
    writeFileSync(join(staticRoot, '.zweiblog-custom-page-uploads/private.txt'), 'PRIVATE-UPLOAD');
    writeFileSync(join(staticRoot, 'img/example.png'), Buffer.from('IMAGE-FIXTURE'));
    writeFileSync(join(staticRoot, 'rss/feed.xml'), '<rss/>');
    writeFileSync(join(staticRoot, 'sitemap/sitemap.xml'), '<urlset/>');
    writeFileSync(join(staticRoot, 'export/example.zip'), Buffer.from('EXPORT-FIXTURE'));
    config.staticPath = staticRoot;

    const module = await Test.createTestingModule({
      controllers: [PublicCustomPageController],
      providers: [
        {
          provide: CustomPageProvider,
          useValue: {
            getCustomPageByPath: jest.fn(async (pathname: string) =>
              pathname === '/site'
                ? { path: '/site', type: 'folder', sandboxMode: 'isolated' }
                : null,
            ),
          },
        },
      ],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>();
    registerPublicStaticAssets(app, staticRoot);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    config.staticPath = originalStaticRoot;
    rmSync(staticRoot, { recursive: true, force: true });
  });

  it('preserves legacy links and applies the sandbox on the redirected response', async () => {
    await request(app.getHttpServer())
      .get('/static/customPage/site/index.html?version=1')
      .expect(308)
      .expect('Location', '/c/site/index.html?version=1')
      .expect('Access-Control-Allow-Origin', '*');
    const response = await request(app.getHttpServer()).get('/c/site/index.html').expect(200);
    expect(response.text).toBe(html);
    expect(response.headers['content-security-policy']).toContain('sandbox allow-scripts');
    expect(response.headers['content-security-policy']).not.toContain('allow-same-origin');
  });

  it.each([
    '/static/%63ustomPage/site/index.html',
    '/static/customPage%2fsite/index.html',
    '/static/%2563ustomPage/site/index.html',
    '/static/customPage%5csite%5cindex.html',
    '/static/img/..%2fcustomPage/site/index.html',
    '/static/img/%2e%2e%2fcustomPage/site/index.html',
    '/static/rss/..%2fcustomPage/site/index.html',
    '/static/tmp/private.txt',
    '/static/export/example.zip',
    '/static/%65xport/example.zip',
    '/static/img/..%2fexport/example.zip',
    '/static/%74mp/private.txt',
    '/static/.zweiblog-custom-page-uploads/private.txt',
    '/static/%2ezweiblog-custom-page-uploads/private.txt',
  ])('never serves private roots through %s', async (url) => {
    const response = await request(app.getHttpServer()).get(url);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.text).not.toContain('Isolated project');
    expect(response.text).not.toContain('PRIVATE-');
    expect(response.text).not.toContain('EXPORT-FIXTURE');
    const head = await request(app.getHttpServer()).head(url);
    expect(head.status).toBeGreaterThanOrEqual(400);
  });

  it.each([
    ['/static/img/example.png', 'image/png'],
    ['/static/rss/feed.xml', 'application/xml'],
    ['/static/sitemap/sitemap.xml', 'application/xml'],
  ])('keeps public assets available at %s', async (url, mime) => {
    const response = await request(app.getHttpServer()).get(url).expect(200);
    expect(response.headers['content-type']).toContain(mime);
  });
});
