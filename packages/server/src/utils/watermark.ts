import sharp from 'sharp';

const MAX_INPUT_PIXELS = 40_000_000;
const MAX_WATERMARK_LENGTH = 200;

function escapeXmlText(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&apos;');
}

export const addWaterMarkToIMG = async (srcImage: Buffer, waterMarkText: string) => {
  if (!Buffer.isBuffer(srcImage) || srcImage.length === 0) {
    throw new Error('A non-empty image buffer is required');
  }
  const text = String(waterMarkText || '').trim().slice(0, MAX_WATERMARK_LENGTH);
  if (!text) return srcImage;

  const input = sharp(srcImage, {
    failOn: 'error',
    limitInputPixels: MAX_INPUT_PIXELS,
  });
  const metadata = await input.metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  if (width < 1 || height < 1 || width * height > MAX_INPUT_PIXELS) {
    throw new Error('Invalid image dimensions');
  }

  const margin = Math.max(8, Math.round(Math.min(width, height) * 0.05));
  const fontSize = Math.max(12, Math.min(72, Math.round(width * 0.04)));
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<text x="${width - margin}" y="${height - margin}" text-anchor="end" ` +
      `font-family="sans-serif" font-size="${fontSize}" font-weight="600" ` +
      `fill="#a7a7a7" fill-opacity="0.8">${escapeXmlText(text)}</text></svg>`,
    'utf8',
  );

  return input.composite([{ input: svg, blend: 'over' }]).toBuffer();
};
