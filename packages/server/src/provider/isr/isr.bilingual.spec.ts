import axios from 'axios';
import { getBilingualRevalidationPaths, ISRProvider } from './isr.provider';

jest.mock('axios', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

describe('ISRProvider bilingual invalidation', () => {
  const makeProvider = () =>
    new ISRProvider({} as any, {} as any, {} as any, {} as any);

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
    expect(getBilingualRevalidationPaths('/en/post/translator')).toEqual([
      '/en/post/translator',
    ]);
    expect(getBilingualRevalidationPaths('/c/custom')).toEqual(['/c/custom']);
  });

  it('attempts the English invalidation even when the Chinese request fails', async () => {
    const provider = makeProvider();
    jest.spyOn(provider.logger, 'error').mockImplementation(() => undefined);
    const get = axios.get as jest.MockedFunction<typeof axios.get>;
    get.mockRejectedValueOnce(new Error('Chinese cache unavailable'));
    get.mockResolvedValueOnce({} as any);

    await provider.activeUrl('/about', false);

    expect(get).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:3001/api/revalidate?path=/about',
    );
    expect(get).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:3001/api/revalidate?path=/en/about',
    );
  });
});
