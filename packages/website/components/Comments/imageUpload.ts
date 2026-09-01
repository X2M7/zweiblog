const COMMENT_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/apng',
  'image/jpeg',
  'image/pjpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/x-bmp',
  'image/x-ms-bmp',
  'image/tiff',
  'image/x-tiff',
  'image/svg+xml',
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
]);

const COMMENT_IMAGE_EXTENSIONS = [
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
] as const;

export const COMMENT_IMAGE_ACCEPT = [
  ...Array.from(COMMENT_IMAGE_MIME_TYPES),
  ...COMMENT_IMAGE_EXTENSIONS,
].join(',');

export const COMMENT_IMAGE_SUPPORT_ZH =
  '支持 PNG、JPEG、GIF、WebP、AVIF、BMP、TIFF、SVG 和可解码的 HEIC/HEIF 图片';
export const COMMENT_IMAGE_SUPPORT_EN =
  'Supported formats: PNG, JPEG, GIF, WebP, AVIF, BMP, TIFF, SVG, and decodable HEIC/HEIF.';
export const COMMENT_IMAGE_HINT_ZH =
  'PNG/JPEG/GIF/WebP/AVIF/BMP/TIFF/SVG/HEIC/HEIF，最大 5 MB';
export const COMMENT_IMAGE_HINT_EN =
  'PNG/JPEG/GIF/WebP/AVIF/BMP/TIFF/SVG/HEIC/HEIF, up to 5 MB';

/** Browser MIME values are inconsistent for HEIC/TIFF, so extensions are UX fallback only. */
export function isSupportedCommentImage(file: Pick<File, 'name' | 'type'>): boolean {
  const mimeType = String(file.type || '').toLowerCase();
  if (COMMENT_IMAGE_MIME_TYPES.has(mimeType)) return true;
  const fileName = String(file.name || '').toLowerCase();
  return COMMENT_IMAGE_EXTENSIONS.some((extension) => fileName.endsWith(extension));
}
