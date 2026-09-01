import { describe, expect, it } from 'vitest';
import {
  buildUploadUrl,
  fitEntireImageCropProps,
  getUploadErrorMessage,
  isSuccessfulUpload,
} from './uploadResponse';

describe('upload response helpers', () => {
  it('adds and escapes the custom upload file name with the correct separator', () => {
    expect(buildUploadUrl('/api/upload', 'logo & light.png')).toBe(
      '/api/upload?name=logo%20%26%20light.png',
    );
    expect(buildUploadUrl('/api/upload?path=assets', 'icons/logo.png')).toBe(
      '/api/upload?path=assets&name=icons%2Flogo.png',
    );
  });

  it('requires both an HTTP success and the application success envelope', () => {
    expect(isSuccessfulUpload({ statusCode: 200 }, true)).toBe(true);
    expect(isSuccessfulUpload({ statusCode: 500 }, true)).toBe(false);
    expect(isSuccessfulUpload({ statusCode: 200 }, false)).toBe(false);
  });

  it('explains proxy body limits for a 413 response without echoing an HTML body', () => {
    const message = getUploadErrorMessage('project.bin', 413);
    expect(message).toContain('自定义页面本身不设应用层单文件上限');
    expect(message).toContain('Nginx、CDN 或面板');
  });

  it('keeps crop coordinates inside the source image so zooming cannot create a blank file', () => {
    expect(fitEntireImageCropProps.minZoom).toBe(1);
    expect(fitEntireImageCropProps.cropperProps).toMatchObject({
      objectFit: 'contain',
      restrictPosition: true,
    });
  });
});
