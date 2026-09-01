import { describe, expect, it } from 'vitest';

import { BROWSER_CROPPABLE_IMAGE_ACCEPT, IMAGE_UPLOAD_ACCEPT } from './imageUpload';

describe('admin image upload formats', () => {
  it('offers all formats handled by the upload API', () => {
    for (const extension of ['.avif', '.bmp', '.tiff', '.svg', '.heic', '.heif']) {
      expect(IMAGE_UPLOAD_ACCEPT).toContain(extension);
    }
  });

  it('keeps formats unsupported by browser croppers on the original-upload path', () => {
    expect(BROWSER_CROPPABLE_IMAGE_ACCEPT).not.toContain('.tiff');
    expect(BROWSER_CROPPABLE_IMAGE_ACCEPT).not.toContain('.heic');
    expect(BROWSER_CROPPABLE_IMAGE_ACCEPT).not.toContain('.svg');
    expect(IMAGE_UPLOAD_ACCEPT).toContain('.tiff');
    expect(IMAGE_UPLOAD_ACCEPT).toContain('.heic');
    expect(IMAGE_UPLOAD_ACCEPT).toContain('.svg');
  });
});
