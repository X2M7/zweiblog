import { describe, expect, it } from 'vitest';

import {
  COMMENT_IMAGE_ACCEPT,
  COMMENT_IMAGE_HINT_EN,
  COMMENT_IMAGE_HINT_ZH,
  isSupportedCommentImage,
} from '../components/Comments/imageUpload';

describe('comment image format selection', () => {
  it.each([
    ['photo.avif', 'image/avif'],
    ['scan.bmp', 'image/bmp'],
    ['scan.tiff', 'image/tiff'],
    ['diagram.svg', 'image/svg+xml'],
    ['iphone.heic', ''],
    ['iphone.HEIF', 'application/octet-stream'],
    ['animation.apng', 'image/png'],
  ])('allows %s even with browser MIME differences', (name, type) => {
    expect(isSupportedCommentImage({ name, type })).toBe(true);
  });

  it('does not mistake arbitrary files for images', () => {
    expect(isSupportedCommentImage({ name: 'payload.html', type: 'text/html' })).toBe(false);
    expect(isSupportedCommentImage({ name: 'payload.svg.exe', type: '' })).toBe(false);
  });

  it('advertises every server-supported extension to the file picker', () => {
    for (const extension of ['.avif', '.bmp', '.tiff', '.svg', '.heic', '.heif']) {
      expect(COMMENT_IMAGE_ACCEPT).toContain(extension);
    }
  });

  it('keeps the visible bilingual hint aligned with the picker', () => {
    for (const format of ['AVIF', 'BMP', 'TIFF', 'SVG', 'HEIC', 'HEIF']) {
      expect(COMMENT_IMAGE_HINT_ZH).toContain(format);
      expect(COMMENT_IMAGE_HINT_EN).toContain(format);
    }
    expect(COMMENT_IMAGE_HINT_ZH).toContain('5 MB');
    expect(COMMENT_IMAGE_HINT_EN).toContain('5 MB');
  });
});
