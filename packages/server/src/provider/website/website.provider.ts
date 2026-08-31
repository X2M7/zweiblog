import { Injectable, Logger } from '@nestjs/common';
import { ChildProcess, spawn } from 'node:child_process';
import path from 'node:path';
import { getSocialValueKind } from 'src/types/social.dto';
import { MetaProvider } from '../meta/meta.provider';
import { SettingProvider } from '../setting/setting.provider';

const ignoreWebsiteWarnings = [
  'Experimental features are not covered by semver',
  'You have enabled experimental feature',
  'Invalid next.config.js options',
  'The value at .experimental has an',
  '(node:62) ExperimentalWarning',
  'null',
];

// The website is an independent Next.js process. Keep its environment small:
// the server process also owns database credentials and other backend-only
// settings that the website neither needs nor should be able to read.
const websiteInheritedEnvironmentKeys = [
  // Cross-platform process startup and temporary/cache directories.
  'PATH',
  'Path',
  'PATHEXT',
  'SystemRoot',
  'ComSpec',
  'COMSPEC',
  'HOME',
  'USERPROFILE',
  'TMPDIR',
  'TMP',
  'TEMP',
  // Stable locale and time formatting.
  'TZ',
  'LANG',
  'LC_ALL',
  // Next.js runtime settings.
  'NODE_ENV',
  'NEXT_TELEMETRY_DISABLED',
  // Settings consumed by the website at startup/runtime.
  'ZWEI_BLOG_SERVER_URL',
  'ZWEI_BLOG_CDN_URL',
  'ZWEI_BLOG_VERSION',
  'ZWEI_BLOG_ALLOW_DOMAINS',
  'ZWEI_BLOG_REVALIDATE',
  'ZWEI_BLOG_REVALIDATE_TIME',
  'ZWEI_BLOG_ALLOW_TRUSTED_CUSTOM_CODE',
  // Backward-compatible alias; new deployments should use the non-public
  // runtime name above.
  'NEXT_PUBLIC_ZWEI_BLOG_ALLOW_UNSAFE_CUSTOM_CODE',
] as const;

const websiteLoadedEnvironmentKeys = [
  'ZWEI_BLOG_ALLOW_DOMAINS',
  'ZWEI_BLOG_REVALIDATE',
  'ZWEI_BLOG_REVALIDATE_TIME',
] as const;

/**
 * Build the explicit environment boundary for the Next.js child process.
 *
 * Do not replace this with `{ ...process.env }`: the parent environment can
 * contain MongoDB credentials, secret-file paths, cloud tokens, proxy
 * credentials, and Node startup flags such as NODE_OPTIONS.
 */
export function createWebsiteProcessEnvironment(
  source: NodeJS.ProcessEnv = process.env,
  loaded: Record<string, unknown> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    // The bundled reverse proxy reaches Next.js over the same container's
    // loopback interface. Docker's inherited HOSTNAME is a container name/IP
    // and must not decide which interface Next.js listens on. The proxy and
    // healthcheck both use port 3001, so an unrelated parent PORT must not
    // redirect the website to a different port either.
    HOSTNAME: '127.0.0.1',
    PORT: '3001',
  };

  for (const key of websiteInheritedEnvironmentKeys) {
    const value = source[key];
    if (value !== undefined) env[key] = value;
  }

  // Database-derived values take precedence, but only for the three website
  // settings loadEnv() is allowed to produce. This also prevents a future
  // caller from smuggling arbitrary keys through the override object.
  for (const key of websiteLoadedEnvironmentKeys) {
    const value = loaded[key];
    if (value !== undefined && value !== null) env[key] = String(value);
  }

  return env;
}

@Injectable()
export class WebsiteProvider {
  // constructor() {}
  ctx: ChildProcess = null;
  logger = new Logger(WebsiteProvider.name);
  constructor(
    private metaProvider: MetaProvider,
    private settingProvider: SettingProvider,
  ) {}
  async init() {
    this.run();
  }
  async loadEnv() {
    const meta = await this.metaProvider.getAll();
    const isrConfig = await this.settingProvider.getISRSetting();
    const isrEnv =
      isrConfig.mode == 'delay'
        ? {
            ZWEI_BLOG_REVALIDATE: 'true',
            ZWEI_BLOG_REVALIDATE_TIME: isrConfig.delay,
          }
        : {
            ZWEI_BLOG_REVALIDATE: 'false',
          };
    if (!meta?.siteInfo) return { ...isrEnv };
    const siteinfo = meta.siteInfo;
    // Legacy/imported metadata may omit this array entirely.
    const socials = Array.isArray(meta.socials) ? meta.socials : [];
    const urls = [];
    const addEach = (u: string) => {
      if (!u) return null;
      try {
        const url = new URL(u);
        if (url?.host) {
          if (!urls.includes(url?.host)) {
            urls.push(url?.host);
          }
        }
      } catch (err) {
        return null;
      }
    };
    addEach(siteinfo?.baseUrl);
    addEach(siteinfo?.siteLogo);
    addEach(siteinfo?.authorLogo);
    addEach(siteinfo?.authorLogoDark);
    addEach(siteinfo?.payAliPay);
    addEach(siteinfo?.payAliPayDark);
    addEach(siteinfo?.payWechat);
    addEach(siteinfo?.payWechatDark);
    for (const social of socials) {
      if (getSocialValueKind(social?.type) === 'qr') {
        addEach(social?.value);
      }
    }
    return { ZWEI_BLOG_ALLOW_DOMAINS: urls.join(','), ...isrEnv };
  }
  async restart(reason: string) {
    this.logger.log(`${reason}重启 website`);
    if (this.ctx) {
      await this.stop();
    }
  }
  async restore(reason: string) {
    this.logger.log(`${reason}`);
    if (this.ctx) this.ctx = null;
    await this.run();
  }
  async stop(noMessage?: boolean) {
    if (this.ctx) {
      this.ctx.unref();
      process.kill(-this.ctx.pid);
      this.ctx = null;
      if (noMessage) return;
      this.logger.log('website 停止成功！');
    }
  }
  async run(): Promise<any> {
    if (process.env['ZWEIBLOG_DISABLE_WEBSITE'] === 'true') {
      this.logger.log('无 website 模式');
      return;
    }
    let cmd = 'pnpm';
    let args = ['dev'];
    if (process.env.NODE_ENV == 'production') {
      cmd = 'node';
      args = ['./packages/website/server.js'];
    }
    const loadEnvs = await this.loadEnv();
    this.logger.log(JSON.stringify(loadEnvs, null, 2));
    if (this.ctx == null) {
      this.ctx = spawn(cmd, args, {
        env: createWebsiteProcessEnvironment(process.env, loadEnvs),
        cwd: path.join(path.resolve(process.cwd(), '..'), 'website'),
        detached: true,
        shell: process.platform === 'win32',
      });
      this.ctx.on('message', (message) => {
        this.logger.log(message);
      });
      this.ctx.on('exit', async () => {
        await this.restore('website 进程退出，自动重启');
      });
      this.ctx.stdout.on('data', (data) => {
        const t: string = data.toString();
        this.logger.log(t.substring(0, t.length - 1));
      });
      this.ctx.stderr.on('data', (data) => {
        const t: string = data.toString();

        let showLog = true;
        for (const each of ignoreWebsiteWarnings) {
          if (t.includes(each)) showLog = false;
        }
        if (showLog) {
          this.logger.error(t.substring(0, t.length - 1));
        }
      });
    } else {
      this.logger.log('Website 启动成功！');
    }
  }
}
