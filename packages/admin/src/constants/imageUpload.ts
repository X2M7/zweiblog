/**
 * Formats accepted by the image upload API. SVG, BMP, TIFF, AVIF and HEIC/HEIF
 * are rasterized to WebP by the server; the original-upload button is the
 * reliable path for formats a browser cannot preview in the crop dialog.
 */
export const IMAGE_UPLOAD_ACCEPT = [
  '.png',
  '.apng',
  '.jpg',
  '.jpeg',
  '.jpe',
  '.jfif',
  '.gif',
  '.webp',
  '.avif',
  '.bmp',
  '.dib',
  '.tif',
  '.tiff',
  '.svg',
  '.heic',
  '.heif',
  '.hif',
].join(',');

/** SVG stays server-side; TIFF and HEIC/HEIF usually cannot be decoded by the cropper. */
export const BROWSER_CROPPABLE_IMAGE_ACCEPT = [
  '.png',
  '.apng',
  '.jpg',
  '.jpeg',
  '.jpe',
  '.jfif',
  '.gif',
  '.webp',
  '.avif',
  '.bmp',
  '.dib',
].join(',');
