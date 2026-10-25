import axios from 'axios';
import { getBilingualRevalidationPaths, ISRProvider } from './isr.provider';

jest.mock('axios', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

describe('ISRProvider bilingual invalidation', () => {
  const makeProvider = () => new ISRProvider({} as any, {} as any, {} as any, {} as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    ['/', ['/', '/en']],
    ['/post/translator', ['/post/translator', '/en/post/translator']],
    ['/page/2', ['/page/2', '/en/page/2']],
    ['/category/notes', ['/category/notes', '/en/category/notes']],
    ['/tag/TeX', ['/tag/TeX', '/en/tag/TeX']],
    ['/timeline', ['/timeline', '/en/timeline']],
    ['/about', ['/about', '/en/about']],
    ['/link', ['/link', '/en/link']],
  ])('maps %s to both language cache entries', (path, expected) => {
    expect(getBilingualRevalidationPaths(path)).toEqual(expected);
  });

  it('does not duplicate an internal English path or invent an unsupported one', () => {
    expect(getBilingualRevalidationPaths('/en/post/translator')).toEqual(['/en/post/translator']);
    expect(getBilingualRevalidationPaths('/c/custom')).toEqual(['/c/custom']);
  });

  it.each(['/', '/post/001', '/page/2', '/category', '/category/notes', '/tag/TeX', '/timeline'])(
    'does not revalidate request-rendered %s or its English variant',
    async (path) => {
      const provider = makeProvider();
      await provider.activeUrl(path, true);
      await provider.activeUrl(path === '/' ? '/en' : `/en${path}`, true);
      expect(axios.get).not.toHaveBeenCalled();
    },
  );

  it('does not enumerate aliases or call getById(null) during a full refresh', async () => {
    const articleProvider = { getById: jest.fn(), getAll: jest.fn() };
    const provider = new ISRProvider(
      articleProvider as any,
      {} as any,
      {} as any,
      { getISRSetting: jest.fn().mockResolvedValue({ mode: 'onDemand' }) } as any,
    );
    jest.spyOn(provider.logger, 'log').mockImplementation(() => undefined);
    (axios.get as jest.Mock).mockResolvedValue({});
    await provider.activeAllFn('article permissions changed', { postId: 1 });
    expect(articleProvider.getById).not.toHaveBeenCalled();
    expect(articleProvider.getAll).not.toHaveBeenCalled();
    expect(axios.get).toHaveBeenCalledTimes(6); // tag, about and link, both languages
  });

  it('attempts the English invalidation even when the Chinese request fails', async () => {
    const provider = makeProvider();
    jest.spyOn(provider.logger, 'error').mockImplementation(() => undefined);
    const get = axios.get as jest.MockedFunction<typeof axios.get>;
    get.mockRejectedValueOnce(new Error('Chinese cache unavailable'));
    get.mockResolvedValueOnce({} as any);

    await provider.activeUrl('/about', false);

    expect(get).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:3001/api/revalidate?path=/about');
    expect(get).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:3001/api/revalidate?path=/en/about');
  });

  it.each([false, true])(
    'revokes RSS before website debounce even when the website is disabled: %s',
    async (disabled) => {
      jest.useFakeTimers();
      const original = process.env.ZWEIBLOG_DISABLE_WEBSITE;
      process.env.ZWEIBLOG_DISABLE_WEBSITE = String(disabled);
      try {
        const rssProvider = { generateRssFeed: jest.fn().mockResolvedValue(undefined) };
        const sitemapProvider = { generateSiteMap: jest.fn() };
        const provider = new ISRProvider(
          {} as any,
          rssProvider as any,
          sitemapProvider as any,
          {} as any,
        );
        jest.spyOn(provider, 'activeWithRetry').mockResolvedValue(undefined);

        const activation = provider.activeAll('privacy changed', 60_000);

        expect(rssProvider.generateRssFeed).toHaveBeenCalledWith('privacy changed', 60_000);
        expect(sitemapProvider.generateSiteMap).not.toHaveBeenCalled();
        await activation;
        jest.advanceTimersByTime(1000);
        expect(rssProvider.generateRssFeed).toHaveBeenCalledTimes(1);
      } finally {
        if (original === undefined) delete process.env.ZWEIBLOG_DISABLE_WEBSITE;
        else process.env.ZWEIBLOG_DISABLE_WEBSITE = original;
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    },
  );
});
