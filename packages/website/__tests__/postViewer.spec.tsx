// @vitest-environment jsdom
import React, { StrictMode } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PostViewer from '../components/PostViewer';
import { GlobalContext } from '../utils/globalContext';
import { updatePageview } from '../api/pageview';

function response(data: unknown) {
  return { ok: true, json: async () => ({ statusCode: 200, data }) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});

async function showArticle(id: number, siteViews: number, strict = false) {
  const view = (
    <GlobalContext.Provider
      value={{ state: { viewer: siteViews, visited: 1 }, setState: () => {} }}
    >
      <PostViewer id={id} />
    </GlobalContext.Provider>
  );
  await act(async () => {
    root.render(strict ? <StrictMode>{view}</StrictMode> : view);
  });
}

describe('article reading counts', () => {
  it('displays the stored count without adding an optimistic extra view', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ viewer: 11 })));
    await showArticle(1, 101);
    expect(container.textContent).toBe('11');
  });

  it('refreshes after one confirmed pageview and keeps the same count when returning', async () => {
    let articleViews = 10;
    const fetch = vi.fn(async (input: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        articleViews += 1;
        return response({ viewer: 101, visited: 1 });
      }
      expect(input).toBe('/api/public/article/viewer/1');
      return response({ viewer: articleViews });
    });
    vi.stubGlobal('fetch', fetch);
    await showArticle(1, 100);
    expect(container.textContent).toBe('10');

    const pageview = await updatePageview('/post/1');
    await showArticle(1, pageview.viewer);
    expect(container.textContent).toBe('11');

    await act(async () => {
      root.render(null);
    });
    await showArticle(1, 101);
    expect(container.textContent).toBe('11');
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });

  it('does not let a slow pre-increment read replace the confirmed new count', async () => {
    const oldRead = deferred<ReturnType<typeof response>>();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockReturnValueOnce(oldRead.promise)
        .mockResolvedValueOnce(response({ viewer: 11 })),
    );
    await showArticle(1, 100);
    await showArticle(1, 101);
    expect(container.textContent).toBe('11');
    await act(async () => {
      oldRead.resolve(response({ viewer: 10 }));
    });
    expect(container.textContent).toBe('11');
  });

  it('loads a new article when the component is reused and ignores the old response', async () => {
    const oldRead = deferred<ReturnType<typeof response>>();
    const fetch = vi
      .fn()
      .mockReturnValueOnce(oldRead.promise)
      .mockResolvedValueOnce(response({ viewer: 40 }));
    vi.stubGlobal('fetch', fetch);
    await showArticle(1, 100);
    await showArticle(2, 100);
    expect(fetch).toHaveBeenLastCalledWith('/api/public/article/viewer/2');
    expect(container.textContent).toBe('40');
    await act(async () => {
      oldRead.resolve(response({ viewer: 10 }));
    });
    expect(container.textContent).toBe('40');
  });

  it('refreshes for consecutive completed visits even when the global count is unchanged', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ viewer: 10 }))
      .mockResolvedValueOnce(response({ viewer: 11 }));
    vi.stubGlobal('fetch', fetch);
    await showArticle(1, 100);
    expect(container.textContent).toBe('10');
    await showArticle(1, 100);
    expect(container.textContent).toBe('11');
  });

  it('keeps the confirmed count when a statistics refresh fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(response({ viewer: 11 }))
        .mockRejectedValueOnce(new Error('offline')),
    );
    await showArticle(1, 101);
    await showArticle(1, 102);
    expect(container.textContent).toBe('11');
  });

  it.each([403, 500])('keeps the confirmed count after an HTTP %i response', async (status) => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(response({ viewer: 11 }))
        .mockResolvedValueOnce({ ok: false, status, json: async () => ({ statusCode: status }) }),
    );
    await showArticle(1, 101);
    await showArticle(1, 102);
    expect(container.textContent).toBe('11');
  });

  it.each([null, { viewer: 0 }])('does not invent a view for %j', async (data) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(data)));
    await showArticle(1, 0);
    expect(container.textContent).toBe('0');
  });

  it('does not count on rendering, including Strict Mode and disabled statistics', async () => {
    window.localStorage.setItem('noViewer', 'true');
    const fetch = vi.fn().mockResolvedValue(response({ viewer: 11 }));
    vi.stubGlobal('fetch', fetch);
    await showArticle(1, 101, true);
    expect(container.textContent).toBe('11');
    expect(fetch.mock.calls.every(([url]) => url === '/api/public/article/viewer/1')).toBe(true);
  });
});
