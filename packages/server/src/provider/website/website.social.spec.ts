import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { createWebsiteProcessEnvironment, WebsiteProvider } from './website.provider';

jest.mock('node:child_process', () => ({
  spawn: jest.fn(),
}));

const makeProvider = (meta: any) =>
  new WebsiteProvider(
    { getAll: jest.fn().mockResolvedValue(meta) } as any,
    { getISRSetting: jest.fn().mockResolvedValue({ mode: 'delay', delay: 60 }) } as any,
  );

describe('WebsiteProvider social domain compatibility', () => {
  it('loads environment settings when a legacy meta document omits socials', async () => {
    const provider = makeProvider({ siteInfo: { baseUrl: 'https://blog.example.com' } });

    await expect(provider.loadEnv()).resolves.toMatchObject({
      ZWEI_BLOG_ALLOW_DOMAINS: 'blog.example.com',
    });
  });

  it('adds every remote QR host but ignores local paths and external profile links', async () => {
    const provider = makeProvider({
      siteInfo: { baseUrl: 'https://blog.example.com' },
      socials: [
        { type: 'wechat', value: 'https://images.example.com/wechat.png' },
        { type: 'wechat-official', value: 'https://official.example.com/qr.png' },
        { type: 'wecom', value: '/uploads/wecom.png' },
        { type: 'github', value: 'https://github.com/example' },
      ],
    });

    await expect(provider.loadEnv()).resolves.toMatchObject({
      ZWEI_BLOG_ALLOW_DOMAINS: 'blog.example.com,images.example.com,official.example.com',
    });
  });
});

describe('WebsiteProvider child process environment', () => {
  const mockedSpawn = spawn as jest.MockedFunction<typeof spawn>;

  afterEach(() => {
    mockedSpawn.mockReset();
  });

  it('keeps backend secrets and process-injection settings out of the website', () => {
    const environment = createWebsiteProcessEnvironment(
      {
        PATH: '/usr/local/bin:/usr/bin',
        NODE_ENV: 'production',
        PORT: '9999',
        HOSTNAME: 'untrusted-parent-hostname',
        TZ: 'Asia/Shanghai',
        ZWEI_BLOG_SERVER_URL: 'http://127.0.0.1:3000',
        ZWEI_BLOG_VERSION: 'test-version',
        ZWEI_BLOG_DATABASE_URL: 'mongodb://secret@example.invalid/database',
        ZWEI_BLOG_DATABASE_URL_FILE: '/run/secrets/mongodb_url',
        MONGO_INITDB_ROOT_PASSWORD: 'database-password',
        MONGO_URL: 'mongodb://another-secret',
        ZWEI_BLOG_JWT_SECRET: 'backend-signing-secret',
        ARBITRARY_SECRET: 'arbitrary-secret',
        NODE_OPTIONS: '--require=/tmp/injected.js',
        HTTPS_PROXY: 'http://proxy-user:proxy-password@example.invalid',
        AWS_SECRET_ACCESS_KEY: 'cloud-secret',
        NEXT_PUBLIC_UNRECOGNIZED_SECRET: 'must-not-be-public',
      },
      {
        ZWEI_BLOG_ALLOW_DOMAINS: 'blog.example.com',
        ZWEI_BLOG_REVALIDATE: 'true',
        ZWEI_BLOG_REVALIDATE_TIME: 60,
        UNEXPECTED_OVERRIDE: 'must-not-pass',
      },
    );

    expect(environment).toEqual({
      PATH: '/usr/local/bin:/usr/bin',
      NODE_ENV: 'production',
      PORT: '3001',
      HOSTNAME: '127.0.0.1',
      TZ: 'Asia/Shanghai',
      ZWEI_BLOG_SERVER_URL: 'http://127.0.0.1:3000',
      ZWEI_BLOG_VERSION: 'test-version',
      ZWEI_BLOG_ALLOW_DOMAINS: 'blog.example.com',
      ZWEI_BLOG_REVALIDATE: 'true',
      ZWEI_BLOG_REVALIDATE_TIME: '60',
    });
  });

  it('uses the fixed loopback host and default website port', () => {
    expect(
      createWebsiteProcessEnvironment({
        HOSTNAME: 'parent-container-id',
        PORT: '9999',
      }),
    ).toEqual({
      HOSTNAME: '127.0.0.1',
      PORT: '3001',
    });
  });

  it('uses the filtered environment when spawning the Next.js process', async () => {
    const provider = makeProvider(null);
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    });
    mockedSpawn.mockReturnValue(child as any);
    jest.spyOn(provider, 'loadEnv').mockResolvedValue({
      ZWEI_BLOG_REVALIDATE: 'false',
    });

    const previousNodeEnv = process.env.NODE_ENV;
    const previousPort = process.env.PORT;
    const previousHostname = process.env.HOSTNAME;
    const previousDatabaseUrl = process.env.ZWEI_BLOG_DATABASE_URL;
    const previousNodeOptions = process.env.NODE_OPTIONS;
    process.env.NODE_ENV = 'production';
    process.env.PORT = '9999';
    process.env.HOSTNAME = 'parent-container-id';
    process.env.ZWEI_BLOG_DATABASE_URL = 'mongodb://must-not-pass';
    process.env.NODE_OPTIONS = '--require=/tmp/must-not-pass.js';

    try {
      await provider.run();
    } finally {
      const restore = (key: string, value: string | undefined) => {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      };
      restore('NODE_ENV', previousNodeEnv);
      restore('PORT', previousPort);
      restore('HOSTNAME', previousHostname);
      restore('ZWEI_BLOG_DATABASE_URL', previousDatabaseUrl);
      restore('NODE_OPTIONS', previousNodeOptions);
    }

    expect(mockedSpawn).toHaveBeenCalledTimes(1);
    const options = mockedSpawn.mock.calls[0][2];
    expect(options?.env).toMatchObject({
      NODE_ENV: 'production',
      PORT: '3001',
      HOSTNAME: '127.0.0.1',
      ZWEI_BLOG_REVALIDATE: 'false',
    });
    expect(options?.env).not.toHaveProperty('ZWEI_BLOG_DATABASE_URL');
    expect(options?.env).not.toHaveProperty('NODE_OPTIONS');
  });
});
