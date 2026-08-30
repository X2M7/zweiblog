import { CommentClientInfoProvider, commentClientInfoInternals } from './clientInfo.provider';

describe('CommentClientInfoProvider', () => {
  it('normalizes mapped IPv4 addresses and labels private addresses locally', async () => {
    const result = await new CommentClientInfoProvider().inspect(
      '::ffff:192.168.1.8',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
    );
    expect(result).toMatchObject({
      ip: '192.168.1.8',
      location: '本地网络',
      browser: expect.stringContaining('Chrome'),
      os: expect.stringContaining('Windows'),
    });
  });

  it('formats both bundled and current xdb region layouts without zero placeholders', () => {
    expect(commentClientInfoInternals.formatRegion('中国|0|江苏省|苏州市|电信')).toBe(
      '中国 · 江苏省 · 苏州市',
    );
    expect(
      commentClientInfoInternals.formatRegion('United States|California|San Jose|ISP|US'),
    ).toBe('United States · California · San Jose');
  });

  it('performs a fully local lookup for a known public IPv4 address', async () => {
    const result = await new CommentClientInfoProvider().inspect('218.4.167.70', 'curl/8.0');
    expect(result.location).toContain('中国');
    expect(result.location).not.toBe('本地网络');
  });
});
