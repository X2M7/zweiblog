import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';

export type SupportedImageType =
  | 'png'
  | 'jpg'
  | 'gif'
  | 'webp'
  | 'avif'
  | 'bmp'
  | 'tiff'
  | 'svg'
  | 'heic';

export interface SafeImageMetadata {
  width: number;
  height: number;
  type: SupportedImageType;
}

const MAX_IMAGE_DIMENSION = 20_000;
const MAX_IMAGE_PIXELS = 40_000_000;
const DIRECT_STORAGE_TYPES = new Set<SupportedImageType>(['png', 'jpg', 'gif', 'webp']);
const SUPPORTED_FORMAT_MESSAGE =
  'Only PNG/APNG, JPEG, GIF, WebP, AVIF, BMP, TIFF, SVG and decodable HEIC/HEIF images are allowed';

function validateDimensions(metadata: SafeImageMetadata) {
  const { width, height } = metadata;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION ||
    width * height > MAX_IMAGE_PIXELS
  ) {
    throw new BadRequestException('Image dimensions exceed the allowed limit');
  }
  return metadata;
}

function parsePng(buffer: Buffer): SafeImageMetadata | null {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature)) return null;
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { type: 'png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function parseGif(buffer: Buffer): SafeImageMetadata | null {
  if (buffer.length < 10 || !['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6))) {
    return null;
  }
  return { type: 'gif', width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
}

const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function parseJpeg(buffer: Buffer): SafeImageMetadata | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) break;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) break;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) break;
    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      if (length < 7) break;
      return {
        type: 'jpg',
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5),
      };
    }
    offset += length;
  }
  throw new BadRequestException('Malformed JPEG image');
}

function readUInt24LE(buffer: Buffer, offset: number) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

function parseWebp(buffer: Buffer): SafeImageMetadata | null {
  if (
    buffer.length < 30 ||
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    return null;
  }

  const format = buffer.toString('ascii', 12, 16);
  if (format === 'VP8X') {
    return {
      type: 'webp',
      width: readUInt24LE(buffer, 24) + 1,
      height: readUInt24LE(buffer, 27) + 1,
    };
  }
  if (format === 'VP8L' && buffer[20] === 0x2f) {
    const b0 = buffer[21];
    const b1 = buffer[22];
    const b2 = buffer[23];
    const b3 = buffer[24];
    return {
      type: 'webp',
      width: 1 + b0 + ((b1 & 0x3f) << 8),
      height: 1 + ((b1 & 0xc0) >> 6) + (b2 << 2) + ((b3 & 0x0f) << 10),
    };
  }
  if (format === 'VP8 ' && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) {
    return {
      type: 'webp',
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }
  throw new BadRequestException('Malformed WebP image');
}

function detectIsoBmffImage(buffer: Buffer): 'avif' | 'heic' | null {
  if (buffer.length < 16 || buffer.toString('ascii', 4, 8) !== 'ftyp') return null;
  const boxLength = buffer.readUInt32BE(0);
  if (boxLength < 16 || boxLength > buffer.length) return null;
  const brands: string[] = [];
  for (let offset = 8; offset + 4 <= boxLength; offset += 4) {
    // Bytes 12..15 are the minor version rather than a compatible brand.
    if (offset === 12) continue;
    brands.push(buffer.toString('ascii', offset, offset + 4).toLowerCase());
  }
  if (brands.some((brand) => brand === 'avif' || brand === 'avis')) return 'avif';
  if (
    brands.some((brand) =>
      ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'].includes(
        brand,
      ),
    )
  ) {
    return 'heic';
  }
  return null;
}

function looksLikeSvg(buffer: Buffer): boolean {
  if (buffer.length < 5) return false;
  const prefix = buffer.subarray(0, Math.min(buffer.length, 16 * 1024)).toString('utf8');
  return /^\uFEFF?\s*(?:<\?xml\s+[^?]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)/iu.test(prefix);
}

function assertSvgHasNoExternalOrActiveContent(buffer: Buffer): void {
  const source = buffer.toString('utf8');
  if (source.includes('\u0000') || !looksLikeSvg(buffer)) {
    throw new BadRequestException('Malformed SVG image');
  }

  // SVG is always rasterized before storage. These checks also prevent the
  // decoder from resolving attacker-controlled local or remote resources.
  const unsafePatterns = [
    /<!DOCTYPE\b/iu,
    /<!ENTITY\b/iu,
    /<\?(?!xml\s)/iu,
    /<(?:[a-z][\w.-]*:)?(?:script|foreignObject|iframe|object|embed|image|use|audio|video|canvas|style)\b/iu,
    /\son[a-z][\w:.-]*\s*=/iu,
    /\s(?:[\w.-]+:)?href\s*=/iu,
    /@import\b/iu,
    /expression\s*\(/iu,
    /url\(\s*['"]?(?!#)/iu,
  ];
  if (unsafePatterns.some((pattern) => pattern.test(source))) {
    throw new BadRequestException('SVG contains external or active content');
  }
}

function decodeUncompressedBmp(buffer: Buffer) {
  if (buffer.length < 54 || buffer.toString('ascii', 0, 2) !== 'BM') {
    throw new BadRequestException('Malformed BMP image');
  }
  const pixelOffset = buffer.readUInt32LE(10);
  const dibSize = buffer.readUInt32LE(14);
  if (dibSize < 40 || 14 + dibSize > buffer.length) {
    throw new BadRequestException('Unsupported BMP header');
  }
  const width = buffer.readInt32LE(18);
  const signedHeight = buffer.readInt32LE(22);
  const height = Math.abs(signedHeight);
  const planes = buffer.readUInt16LE(26);
  const bitsPerPixel = buffer.readUInt16LE(28);
  const compression = buffer.readUInt32LE(30);
  validateDimensions({ type: 'bmp', width, height });
  if (planes !== 1 || compression !== 0 || ![24, 32].includes(bitsPerPixel)) {
    throw new BadRequestException('Only uncompressed 24-bit and 32-bit BMP images are supported');
  }

  const bytesPerPixel = bitsPerPixel / 8;
  const rowSize = Math.ceil((width * bytesPerPixel) / 4) * 4;
  if (
    !Number.isSafeInteger(rowSize) ||
    pixelOffset < 14 + dibSize ||
    pixelOffset + rowSize * height > buffer.length
  ) {
    throw new BadRequestException('Malformed BMP pixel data');
  }

  const raw = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceY = signedHeight > 0 ? height - y - 1 : y;
    const sourceRow = pixelOffset + sourceY * rowSize;
    for (let x = 0; x < width; x += 1) {
      const source = sourceRow + x * bytesPerPixel;
      const target = (y * width + x) * 4;
      raw[target] = buffer[source + 2];
      raw[target + 1] = buffer[source + 1];
      raw[target + 2] = buffer[source];
      // BI_RGB does not define a meaningful alpha channel; zero alpha is very
      // common in otherwise opaque 32-bit BMP files.
      raw[target + 3] = 0xff;
    }
  }
  return { data: raw, width, height };
}

export function detectSupportedImageType(buffer: Buffer): SupportedImageType | null {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'png';
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8) return 'jpg';
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6))) {
    return 'gif';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  if (buffer.length >= 2 && buffer.toString('ascii', 0, 2) === 'BM') return 'bmp';
  if (
    buffer.length >= 4 &&
    (buffer.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) ||
      buffer.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a])) ||
      buffer.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2b, 0x00])) ||
      buffer.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2b])))
  ) {
    return 'tiff';
  }
  const isoBmffType = detectIsoBmffImage(buffer);
  if (isoBmffType) return isoBmffType;
  if (looksLikeSvg(buffer)) return 'svg';
  return null;
}

function readDirectStorageMetadata(buffer: Buffer, type: SupportedImageType) {
  const metadata =
    type === 'png'
      ? parsePng(buffer)
      : type === 'jpg'
        ? parseJpeg(buffer)
        : type === 'gif'
          ? parseGif(buffer)
          : type === 'webp'
            ? parseWebp(buffer)
            : null;
  if (!metadata) throw new BadRequestException(`Malformed ${type.toUpperCase()} image`);
  return validateDimensions(metadata);
}

export interface PreparedImage {
  buffer: Buffer;
  metadata: SafeImageMetadata;
  originalType: SupportedImageType;
  normalized: boolean;
}

/**
 * Decode an allow-listed image and return a metadata-free, single-frame WebP.
 * This is used for anonymous uploads and for formats that must not be served
 * directly (notably SVG, TIFF and HEIC).
 */
export async function normalizeImageToWebp(buffer: Buffer, quality = 90): Promise<PreparedImage> {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new BadRequestException('An image file is required');
  }
  const originalType = detectSupportedImageType(buffer);
  if (!originalType) throw new BadRequestException(SUPPORTED_FORMAT_MESSAGE);
  if (DIRECT_STORAGE_TYPES.has(originalType)) readDirectStorageMetadata(buffer, originalType);
  if (originalType === 'svg') assertSvgHasNoExternalOrActiveContent(buffer);

  let normalized: Buffer;
  try {
    const input =
      originalType === 'bmp'
        ? (() => {
            const bmp = decodeUncompressedBmp(buffer);
            return sharp(bmp.data, {
              raw: { width: bmp.width, height: bmp.height, channels: 4 },
              limitInputPixels: MAX_IMAGE_PIXELS,
            });
          })()
        : sharp(buffer, {
            animated: false,
            failOn: 'error',
            limitInputPixels: MAX_IMAGE_PIXELS,
          });
    normalized = await input
      .rotate()
      .webp({
        quality: Math.max(1, Math.min(100, Math.round(quality))),
        alphaQuality: 100,
        effort: 4,
      })
      .toBuffer();
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    if (originalType === 'heic') {
      throw new BadRequestException(
        'This HEIC/HEIF image cannot be decoded by the image codecs installed on this server; convert it to AVIF, WebP, PNG or JPEG first',
      );
    }
    throw new BadRequestException(`${originalType.toUpperCase()} image cannot be safely decoded`);
  }

  return {
    buffer: normalized,
    metadata: readSafeImageMetadata(normalized),
    originalType,
    normalized: true,
  };
}

/** Keep already web-safe formats intact; rasterize other supported formats. */
export async function prepareImageForStorage(buffer: Buffer): Promise<PreparedImage> {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new BadRequestException('An image file is required');
  }
  const originalType = detectSupportedImageType(buffer);
  if (!originalType) throw new BadRequestException(SUPPORTED_FORMAT_MESSAGE);
  if (!DIRECT_STORAGE_TYPES.has(originalType)) return normalizeImageToWebp(buffer);
  return {
    buffer,
    metadata: readDirectStorageMetadata(buffer, originalType),
    originalType,
    normalized: false,
  };
}

/** Read all supported formats while still fully decoding non-web formats. */
export async function readSafeImageMetadataAsync(buffer: Buffer): Promise<SafeImageMetadata> {
  const prepared = await prepareImageForStorage(buffer);
  return prepared.normalized
    ? { ...prepared.metadata, type: prepared.originalType }
    : prepared.metadata;
}

export function readSafeImageMetadata(buffer: Buffer): SafeImageMetadata {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new BadRequestException('An image file is required');
  }
  const type = detectSupportedImageType(buffer);
  if (!type) throw new BadRequestException(SUPPORTED_FORMAT_MESSAGE);
  if (!DIRECT_STORAGE_TYPES.has(type)) {
    throw new BadRequestException(`${type.toUpperCase()} images must be safely decoded first`);
  }
  return readDirectStorageMetadata(buffer, type);
}
