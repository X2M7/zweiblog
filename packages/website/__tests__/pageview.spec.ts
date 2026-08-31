import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getPageview,
  shouldUpdatePageviewForRouteChange,
  updatePageview,
} from '../api/pageview';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('pageview API resilience', () => {
  it('does not count same-page shallow route changes', () => {
    expect(shouldUpdatePageviewForRouteChange({ shallow: true })).toBe(false);
    expect(shouldUpdatePageviewForRouteChange({ shallow: false })).toBe(true);
    expect(shouldUpdatePageviewForRouteChange()).toBe(true);
  });

  it('normalizes a successful response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ statusCode: 200, data: { viewer: 4.9, visited: 2 } }),
      }),
    );

    await expect(getPageview('/about')).resolves.toEqual({ viewer: 4, visited: 2 });
  });

  it('fails closed to zero when the backend or proxy rejects the update', async () => {
    const storage = {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
    };
    vi.stubGlobal('window', { localStorage: storage });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ statusCode: 403 }),
      }),
    );

    await expect(updatePageview('/about')).resolves.toEqual({ viewer: 0, visited: 0 });
    expect(storage.setItem).toHaveBeenCalledWith('visited', 'true');
    expect(storage.setItem).toHaveBeenCalledWith('visited-/about', 'true');
  });

  it('does not reject page rendering when fetch fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    await expect(getPageview('/about')).resolves.toEqual({ viewer: 0, visited: 0 });
  });
});
