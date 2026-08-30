import { BadRequestException } from '@nestjs/common';
import { normalizeCommentPath, normalizeCommentPaths } from './comment';

describe('comment path canonicalization', () => {
  it('uses the decoded browser pathname as the canonical storage key', () => {
    expect(normalizeCommentPath('/post/%E4%B8%AD%E6%96%87%20slug/')).toBe('/post/中文 slug');
    expect(normalizeCommentPath('/post/中文 slug')).toBe('/post/中文 slug');
  });

  it('deduplicates encoded and decoded forms in count queries', () => {
    expect(normalizeCommentPaths(['/post/%E4%B8%AD%E6%96%87%20slug', '/post/中文 slug/'])).toEqual([
      '/post/中文 slug',
    ]);
  });

  it('rejects malformed percent encoding instead of creating an unreachable key', () => {
    expect(() => normalizeCommentPath('/post/%E0%A4%A')).toThrow(BadRequestException);
  });
});
