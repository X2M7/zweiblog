import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { config } from 'src/config';
import { CustomPageProvider } from 'src/provider/customPage/customPage.provider';
import { PublicCustomPageController } from './customPage.controller';

describe('multi-file custom-page HTTP responses', () => {
  let app: INestApplication;
  let temporaryStaticPath: string;
  const originalStaticPath = config.staticPath;
  const getCustomPageByPath = jest.fn();
  const pdf = Buffer.from('%PDF-1.7\n0123456789abcdefghijklmnopqrstuvwxyz\n%%EOF');

  beforeAll(async () => {
    temporaryStaticPath = mkdtempSync(join(tmpdir(), 'zweiblog-custom-page-http-'));
    const pageRoot = join(temporaryStaticPath, 'customPage', 'site');
    mkdirSync(join(pageRoot, 'assets'), { recursive: true });
    mkdirSync(join(pageRoot, 'docs'));
    mkdirSync(join(pageRoot, 'empty'));
    writeFileSync(join(pageRoot, 'index.html'), '<!doctype html><main>SPA root</main>');
    writeFileSync(join(pageRoot, 'docs', 'index.html'), '<!doctype html><main>Docs</main>');
    writeFileSync(join(pageRoot, 'assets', 'app.js'), 'window.projectReady = true;');
    writeFileSync(join(pageRoot, 'assets', 'site.css'), 'main { color: #123456; }');
    writeFileSync(join(pageRoot, 'manual.pdf'), pdf);
    config.staticPath = temporaryStaticPath;

    getCustomPageByPath.mockImplementation(async (pathname: string) => {
      if (pathname !== '/site') return null;
      return { path: '/site', type: 'folder', sandboxMode: 'isolated' };
    });

    const module = await Test.createTestingModule({
      controllers: [PublicCustomPageController],
      providers: [{ provide: CustomPageProvider, useValue: { getCustomPageByPath } }],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    config.staticPath = originalStaticPath;
    rmSync(temporaryStaticPath, { recursive: true, force: true });
  });

  it('canonicalises project directories, preserves queries and serves their index', async () => {
    await request(app.getHttpServer())
      .get('/c/site?mode=preview')
      .expect(302)
      .expect('Location', '/c/site/?mode=preview');
    await request(app.getHttpServer())
      .get('/c/site/docs?lang=en')
      .expect(302)
      .expect('Location', '/c/site/docs/?lang=en');

    const response = await request(app.getHttpServer()).get('/c/site/docs/').expect(200);
    expect(response.headers['content-type']).toMatch(/^text\/html\b/);
    expect(response.text).toContain('<main>Docs</main>');
  });

  it('serves JS, CSS and PDF with nosniff-compatible MIME types', async () => {
    const javascript = await request(app.getHttpServer()).get('/c/site/assets/app.js').expect(200);
    expect(javascript.headers['content-type']).toMatch(/^(text|application)\/javascript\b/);
    expect(javascript.text).toContain('window.projectReady');

    const stylesheet = await request(app.getHttpServer())
      .get('/c/site/assets/site.css')
      .expect(200);
    expect(stylesheet.headers['content-type']).toMatch(/^text\/css\b/);

    const document = await request(app.getHttpServer()).get('/c/site/manual.pdf').expect(200);
    expect(document.headers['content-type']).toMatch(/^application\/pdf\b/);
    expect(document.headers['accept-ranges']).toBe('bytes');
    expect(document.body).toEqual(pdf);
  });

  it('supports byte ranges and HEAD for large embeddable project files', async () => {
    const start = 9;
    const end = 18;
    const response = await request(app.getHttpServer())
      .get('/c/site/manual.pdf')
      .set('Range', `bytes=${start}-${end}`)
      .expect(206);

    expect(response.headers['accept-ranges']).toBe('bytes');
    expect(response.headers['content-range']).toBe(`bytes ${start}-${end}/${pdf.byteLength}`);
    expect(response.headers['content-length']).toBe(String(end - start + 1));
    expect(response.body).toEqual(pdf.subarray(start, end + 1));

    const head = await request(app.getHttpServer()).head('/c/site/manual.pdf').expect(200);
    expect(head.headers['content-type']).toMatch(/^application\/pdf\b/);
    expect(head.headers['content-length']).toBe(String(pdf.byteLength));
    expect(head.body).toEqual({});
  });

  it('falls back only for SPA navigation and keeps missing assets as 404', async () => {
    const spa = await request(app.getHttpServer())
      .get('/c/site/dashboard/settings')
      .set('Accept', 'text/html,application/xhtml+xml;q=0.9')
      .expect(200);
    expect(spa.headers['content-type']).toMatch(/^text\/html\b/);
    expect(spa.headers.vary).toContain('Accept');
    expect(spa.text).toContain('SPA root');

    await request(app.getHttpServer())
      .get('/c/site/dashboard/settings')
      .set('Accept', '*/*')
      .expect(404);
    await request(app.getHttpServer())
      .get('/c/site/assets/missing.js')
      .set('Accept', 'text/html')
      .expect(404);
    await request(app.getHttpServer())
      .get('/c/site/assets/missing.css')
      .set('Accept', 'text/html')
      .expect(404);
    await request(app.getHttpServer())
      .get('/c/site/missing.pdf')
      .set('Accept', 'text/html')
      .expect(404);
    await request(app.getHttpServer()).get('/c/site/empty/').set('Accept', 'text/html').expect(404);
  });

  it('uses the same 4096-byte and 64-segment envelope as project uploads', async () => {
    getCustomPageByPath.mockClear();
    await request(app.getHttpServer())
      .get(`/c/${'a'.repeat(1025)}`)
      .expect(404);
    expect(getCustomPageByPath).toHaveBeenCalledTimes(1);

    getCustomPageByPath.mockClear();
    await request(app.getHttpServer())
      .get(`/c/${Array(65).fill('x').join('/')}`)
      .expect(400);
    expect(getCustomPageByPath).not.toHaveBeenCalled();

    getCustomPageByPath.mockClear();
    await request(app.getHttpServer())
      .get(`/c/${'a'.repeat(4097)}`)
      .expect(400);
    expect(getCustomPageByPath).not.toHaveBeenCalled();
  });
});
