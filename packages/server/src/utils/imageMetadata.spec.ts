import { readSafeImageMetadata } from './imageMetadata';

describe('readSafeImageMetadata', () => {
  it('reads a PNG IHDR without invoking a general-purpose decoder', () => {
    const png = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
    png.write('IHDR', 12, 'ascii');
    png.writeUInt32BE(640, 16);
    png.writeUInt32BE(480, 20);
    expect(readSafeImageMetadata(png)).toEqual({ type: 'png', width: 640, height: 480 });
  });

  it('rejects active or unknown file formats', () => {
    expect(() => readSafeImageMetadata(Buffer.from('<svg onload="x">'))).toThrow(
      'Only PNG, JPEG, GIF and WebP',
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
});
