import { BadRequestException } from '@nestjs/common';

export interface SafeImageMetadata {
  width: number;
  height: number;
  type: 'png' | 'jpg' | 'gif' | 'webp';
}

const MAX_IMAGE_DIMENSION = 20_000;
const MAX_IMAGE_PIXELS = 40_000_000;

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
  if (
    format === 'VP8 ' &&
    buffer[23] === 0x9d &&
    buffer[24] === 0x01 &&
    buffer[25] === 0x2a
  ) {
    return {
      type: 'webp',
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }
  throw new BadRequestException('Malformed WebP image');
}

export function readSafeImageMetadata(buffer: Buffer): SafeImageMetadata {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new BadRequestException('An image file is required');
  }

  const metadata = parsePng(buffer) || parseJpeg(buffer) || parseGif(buffer) || parseWebp(buffer);
  if (!metadata) {
    throw new BadRequestException('Only PNG, JPEG, GIF and WebP images are allowed');
  }
  return validateDimensions(metadata);
}
