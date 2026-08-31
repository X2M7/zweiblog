import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { MetaProvider } from './provider/meta/meta.provider';

import { NestExpressApplication } from '@nestjs/platform-express';
import { config as globalConfig } from './config/index';
import { checkOrCreate } from './utils/checkFolder';
import * as path from 'path';
import { ISRProvider } from './provider/isr/isr.provider';
import { InitProvider } from './provider/init/init.provider';
import { json, NextFunction, Request, Response } from 'express';
import { UserProvider } from './provider/user/user.provider';
import { SettingProvider } from './provider/setting/setting.provider';
import { WebsiteProvider } from './provider/website/website.provider';
import { initJwt } from './utils/initJwt';

async function bootstrap() {
  const jwtSecret = await initJwt();
  global.jwtSecret = jwtSecret;
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // The bundled Caddy and the local Next development proxy connect over
  // loopback. Trusting whole private/link-local ranges would let any client
  // that can reach port 3000 spoof X-Forwarded-For and bypass IP rate limits.
  // External proxy deployments must opt in to their exact address/subnet.
  app.set('trust proxy', process.env.ZWEI_BLOG_TRUST_PROXY?.trim() || 'loopback');
  app.disable('x-powered-by');
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    if (req.secure) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    }
    if (req.path.startsWith('/api/')) {
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      );
    }
    next();
  });

  // Public comments are at most 50k characters. Parse them with a tight limit
  // before the broader admin/backup JSON parser so oversized anonymous bodies
  // are rejected without allocating the global 5 MB allowance.
  // 256 KiB accommodates 50k CJK characters plus JSON/profile metadata.
  app.use('/api/public/comment', json({ limit: '256kb' }));
  app.use(json({ limit: '5mb' }));

  // Custom-page HTML and project files must always pass through `/c`, where
  // the per-page CSP sandbox is applied. Preserve old generated asset URLs by
  // redirecting them instead of serving the bytes through the unsafe generic
  // static mount.
  app.use('/static/customPage', (req: Request, res: Response) => {
    const legacyPrefix = '/static/customPage';
    const suffix = req.originalUrl.startsWith(legacyPrefix)
      ? req.originalUrl.slice(legacyPrefix.length)
      : '';
    // Isolated custom pages have an opaque origin, so legacy module URLs need
    // CORS on both this redirect and the final /c response.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.redirect(308, `/c${suffix}`);
  });
  app.use('/static/.zweiblog-custom-page-uploads', (_req, res) => {
    res.status(404).end();
  });
  app.useStaticAssets(globalConfig.staticPath, {
    prefix: '/static/',
  });

  // 查看文件夹是否存在 并创建.
  checkOrCreate(globalConfig.codeRunnerPath);
  checkOrCreate(globalConfig.staticPath);
  checkOrCreate(path.join(globalConfig.staticPath, 'img'));
  checkOrCreate(path.join(globalConfig.staticPath, 'tmp'));
  checkOrCreate(path.join(globalConfig.staticPath, 'export'));

  // 自定义页面
  checkOrCreate(path.join(globalConfig.staticPath, 'customPage'));

  // rss
  checkOrCreate(path.join(globalConfig.staticPath, 'rss'));
  app.useStaticAssets(path.join(globalConfig.staticPath, 'rss'), {
    prefix: '/rss/',
  });

  // sitemap
  checkOrCreate(path.join(globalConfig.staticPath, 'sitemap'));
  app.useStaticAssets(path.join(globalConfig.staticPath, 'sitemap'), {
    prefix: '/sitemap/',
  });

  if (process.env.NODE_ENV !== 'production' || process.env.ZWEI_BLOG_ENABLE_SWAGGER === 'true') {
    const config = new DocumentBuilder()
      .setTitle('ZweiBlog API Reference')
      .setDescription('API Token 请在后台设置页面获取，请添加到请求头的 token 字段中进行鉴权。')
      .setVersion('1.0')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('swagger', app, document);
  }
  // Containers keep the historic all-interface default. Native development
  // can opt into loopback-only binding so the admin API is not exposed to the
  // local network merely by starting the project.
  await app.listen(3000, process.env.ZWEI_BLOG_HOST?.trim() || '0.0.0.0');

  const websiteProvider = app.get(WebsiteProvider);

  await websiteProvider.init();
  process.on('SIGINT', async () => {
    await websiteProvider.stop();
    console.log('检测到关闭信号，优雅退出！');
    process.exit();
  });

  const initProvider = app.get(InitProvider);
  await initProvider.initVersion();
  await initProvider.initRestoreKey();
  if (await initProvider.checkHasInited()) {
    // 新版本自动启动图床压缩功能
    await initProvider.washStaticSetting();
    // 老版本自定义数据洗一下
    await initProvider.washCustomPage();
    // 老版本的分类数据洗一下
    await initProvider.washCategory();
    const userProvider = app.get(UserProvider);
    // 老版本没加盐的用户数据洗一下。
    await userProvider.washUserWithSalt();
    const settingProvider = app.get(SettingProvider);
    // 老版本菜单数据洗一下。
    await settingProvider.washDefaultMenu();
    const metaProvider = app.get(MetaProvider);
    await metaProvider.updateTotalWords('首次启动');
    // 触发增量渲染生成静态页面，防止升级后内容为空
    const isrProvider = app.get(ISRProvider);
    isrProvider.activeAll('首次启动触发全量渲染！', 1000, {
      forceActice: true,
    });
  }
  setTimeout(() => {
    console.log('应用已启动，端口: 3000');
    console.log('API 端点地址: http://<domain>/api');
    console.log('swagger 地址: http://<domain>/swagger');
    console.log('项目主页: https://github.com/X2M7/zweiblog');
    console.log('问题反馈: https://github.com/X2M7/zweiblog/issues');
  }, 3000);
}
bootstrap();
