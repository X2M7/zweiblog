import { describe, expect, it } from 'vitest';
import { recentVisitHref } from './recentVisitHref';

describe('recent visit links', () => {
  it.each([
    '//outside.example',
    '/\\outside.example',
    'https://outside.example',
    'javascript:alert(1)',
    '/\noutside.example',
    undefined,
  ])('rejects unsafe legacy path %s', (path) => {
    expect(recentVisitHref(path)).toBeUndefined();
  });
  it('keeps ordinary same-origin article links', () => {
    expect(recentVisitHref('/post/7')).toBe('/post/7');
  });
});
