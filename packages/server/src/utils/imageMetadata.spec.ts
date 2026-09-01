import sharp from 'sharp';
import {
  detectSupportedImageType,
  normalizeImageToWebp,
  readSafeImageMetadata,
  readSafeImageMetadataAsync,
} from './imageMetadata';

function bmpBuffer(width = 2, height = 3) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowSize * height;
  const buffer = Buffer.alloc(14 + 40 + pixelBytes);
  buffer.write('BM', 0, 'ascii');
  buffer.writeUInt32LE(buffer.length, 2);
  buffer.writeUInt32LE(54, 10);
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(height, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(24, 28);
  buffer.writeUInt32LE(pixelBytes, 34);
  buffer.fill(0x7f, 54);
  return buffer;
}

function fakeHeicBuffer() {
  const buffer = Buffer.alloc(24);
  buffer.writeUInt32BE(buffer.length, 0);
  buffer.write('ftyp', 4, 'ascii');
  buffer.write('heic', 8, 'ascii');
  buffer.write('mif1', 16, 'ascii');
  buffer.write('heic', 20, 'ascii');
  return buffer;
}

describe('readSafeImageMetadata', () => {
  it('reads a PNG IHDR without invoking a general-purpose decoder', () => {
    const png = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
    png.write('IHDR', 12, 'ascii');
    png.writeUInt32BE(640, 16);
    png.writeUInt32BE(480, 20);
    expect(readSafeImageMetadata(png)).toEqual({ type: 'png', width: 640, height: 480 });
  });

  it('rejects unknown file formats', () => {
    expect(() => readSafeImageMetadata(Buffer.from('<html>not an image</html>'))).toThrow(
      'Only PNG/APNG, JPEG, GIF, WebP, AVIF, BMP, TIFF, SVG',
    );
  });

  it('rejects decompression-bomb dimensions', () => {
    const png = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
    png.write('IHDR', 12, 'ascii');
    png.writeUInt32BE(20_000, 16);
    png.writeUInt32BE(20_000, 20);
    expect(() => readSafeImageMetadata(png)).toThrow('dimensions exceed');
  });

  it('normalizes AVIF, BMP, TIFF and safe SVG uploads to WebP', async () => {
    const source = sharp({
      create: {
        width: 4,
        height: 3,
        channels: 4,
        background: { r: 20, g: 40, b: 60, alpha: 1 },
      },
    });
    const inputs = [
      { type: 'avif', buffer: await source.clone().avif().toBuffer() },
      { type: 'bmp', buffer: bmpBuffer(4, 3) },
      { type: 'tiff', buffer: await source.clone().tiff().toBuffer() },
      {
        type: 'svg',
        buffer: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><defs><linearGradient id="g"><stop stop-color="#fff"/></linearGradient></defs><rect width="4" height="3" fill="url(#g)"/></svg>',
        ),
      },
    ] as const;

    for (const input of inputs) {
      expect(detectSupportedImageType(input.buffer)).toBe(input.type);
      const prepared = await normalizeImageToWebp(input.buffer);
      expect(prepared).toMatchObject({ originalType: input.type, normalized: true });
      expect(prepared.metadata).toEqual({ type: 'webp', width: 4, height: 3 });
      await expect(readSafeImageMetadataAsync(input.buffer)).resolves.toEqual({
        type: input.type,
        width: 4,
        height: 3,
      });
    }
  });

  it('never stores SVG active or external content', async () => {
    await expect(
      normalizeImageToWebp(
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><script>alert(1)</script></svg>',
        ),
      ),
    ).rejects.toThrow('external or active content');
    await expect(
      normalizeImageToWebp(
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><image href="https://example.com/x.png"/></svg>',
        ),
      ),
    ).rejects.toThrow('external or active content');
    await expect(
      normalizeImageToWebp(
        Buffer.from(
          '<?xml-stylesheet href="https://example.com/x.css"?><svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>',
        ),
      ),
    ).rejects.toThrow();
  });

  it('rejects BMP compression modes the bounded decoder does not implement', async () => {
    const compressed = bmpBuffer();
    compressed.writeUInt32LE(1, 30);
    await expect(normalizeImageToWebp(compressed)).rejects.toThrow(
      'Only uncompressed 24-bit and 32-bit BMP images are supported',
    );
  });

  it('recognizes HEIC and reports a missing or incompatible decoder clearly', async () => {
    const heic = fakeHeicBuffer();
    expect(detectSupportedImageType(heic)).toBe('heic');
    await expect(normalizeImageToWebp(heic)).rejects.toThrow(
      'cannot be decoded by the image codecs installed on this server',
    );
  });
});
