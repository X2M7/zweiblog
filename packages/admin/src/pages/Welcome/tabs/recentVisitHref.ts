export function recentVisitHref(path: unknown): string | undefined {
  if (
    typeof path !== 'string' ||
    !path.startsWith('/') ||
    path.startsWith('//') ||
    /[\\\u0000-\u001f\u007f]/u.test(path)
  )
    return undefined;
  try {
    const base = 'https://local.invalid';
    const url = new URL(path, base);
    return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : undefined;
  } catch {
    return undefined;
  }
}
