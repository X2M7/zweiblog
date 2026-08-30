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

  it('redirects nested legacy paths without losing suffixes', async () => {
    await request(app.getHttpServer())
      .get('/custom/site/assets/app.js?version=1')
      .expect(301)
      .expect('Location', '/c/site/assets/app.js?version=1');
  });
});
