import { WebsiteProvider } from './website.provider';

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
