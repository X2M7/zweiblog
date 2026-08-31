const DEFAULT_PAGEVIEW_RESPONSE = { viewer: 0, visited: 0 };

export interface PageViewData {
  viewer: number;
  visited: number;
}

export function shouldUpdatePageviewForRouteChange(options?: {
  shallow?: boolean;
}): boolean {
  return !options?.shallow;
}

function normalizePageview(value: unknown): PageViewData {
  if (!value || typeof value !== "object") return DEFAULT_PAGEVIEW_RESPONSE;
  const viewer = Number((value as Partial<PageViewData>).viewer);
  const visited = Number((value as Partial<PageViewData>).visited);
  if (!Number.isFinite(viewer) || !Number.isFinite(visited)) {
    return DEFAULT_PAGEVIEW_RESPONSE;
  }
  return {
    viewer: Math.max(0, Math.trunc(viewer)),
    visited: Math.max(0, Math.trunc(visited)),
  };
}

async function requestPageview(input: RequestInfo | URL, init?: RequestInit) {
  try {
    const response = await fetch(input, init);
    if (!response.ok) return DEFAULT_PAGEVIEW_RESPONSE;
    const body = await response.json();
    if (body?.statusCode === 233) return DEFAULT_PAGEVIEW_RESPONSE;
    return normalizePageview(body?.data);
  } catch (error) {
    // Visit statistics are optional and must never take down the page when a
    // local proxy, backend, or network is temporarily unavailable.
    console.warn("访问统计请求失败", error);
    return DEFAULT_PAGEVIEW_RESPONSE;
  }
}

export const getPageview = async (pathname: string): Promise<PageViewData> => {
  void pathname;
  return requestPageview(`/api/public/viewer`, { method: "GET" });
};

export const updatePageview = async (
  pathname: string
): Promise<PageViewData> => {
  const hasVisited = window.localStorage.getItem("visited");
  const hasVisitedCurrentPath = window.localStorage.getItem(
    `visited-${pathname}`
  );

  if (!hasVisited) {
    window.localStorage.setItem("visited", "true");
  }

  if (!hasVisitedCurrentPath) {
    window.localStorage.setItem(`visited-${pathname}`, "true");
  }

  return requestPageview(
    `/api/public/viewer?isNew=${!hasVisited}&isNewByPath=${!hasVisitedCurrentPath}`,
    { method: "POST" }
  );
};

