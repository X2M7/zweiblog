import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { CustomPageProvider } from '../../provider/customPage/customPage.provider';
import {
  PublicCustomPageController,
  PublicOldCustomPageRedirectController,
} from './customPage.controller';

describe('custom page routes on Express 5', () => {
  let app: INestApplication;
  const getCustomPageByPath = jest.fn();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [PublicCustomPageController, PublicOldCustomPageRedirectController],
      providers: [
        {
          provide: CustomPageProvider,
          useValue: { getCustomPageByPath },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    getCustomPageByPath.mockReset().mockResolvedValue(null);
  });

  it('matches nested native custom-page paths', async () => {
    await request(app.getHttpServer()).get('/c/site/assets/app.js').expect(404);
    expect(getCustomPageByPath).toHaveBeenNthCalledWith(1, '/site/assets/app.js');
  });

  it('serves complete HTML and JavaScript with the isolated sandbox by default', async () => {
    getCustomPageByPath.mockResolvedValue({
      path: '/latex',
      type: 'file',
      html: '<!doctype html><html><body><script>window.widgetReady = true</script></body></html>',
      sandboxMode: 'isolated',
    });

    const response = await request(app.getHttpServer()).get('/c/latex').expect(200);

    expect(response.text).toContain('<script>window.widgetReady = true</script>');
    expect(response.headers['content-security-policy']).toContain('sandbox allow-scripts');
    expect(response.headers['content-security-policy']).not.toContain('allow-same-origin');
    expect(response.headers['access-control-allow-origin']).toBe('*');
    expect(response.headers['referrer-policy']).toBe('same-origin');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('allows explicitly trusted pages to use same-origin browser APIs', async () => {
    getCustomPageByPath.mockResolvedValue({
      path: '/trusted-widget',
      type: 'file',
      html: '<script>localStorage.setItem("widget", "ready")</script>',
      sandboxMode: 'trusted',
    });

    const response = await request(app.getHttpServer()).get('/c/trusted-widget').expect(200);

    expect(response.text).toContain('localStorage.setItem');
    expect(response.headers['content-security-policy']).toContain('allow-same-origin');
    expect(response.headers['content-security-policy']).toContain(
      'allow-top-navigation-by-user-activation',
    );
    expect(response.headers['content-security-policy']).not.toMatch(
      /\ballow-top-navigation(?:\s|;)/,
    );
  });

  it('redirects nested legacy paths without losing suffixes', async () => {
    await request(app.getHttpServer())
      .get('/custom/site/assets/app.js?version=1')
      .expect(301)
      .expect('Location', '/c/site/assets/app.js?version=1');
  });
});
