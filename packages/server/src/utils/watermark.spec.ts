import sharp from 'sharp';
import { addWaterMarkToIMG } from './watermark';

describe('image watermark', () => {
  it('renders local text with the original image dimensions', async () => {
    const input = await sharp({
      create: { width: 320, height: 180, channels: 3, background: '#224466' },
    })
      .png()
      .toBuffer();

    const output = await addWaterMarkToIMG(input, 'zweiblog <local> & safe');
    const metadata = await sharp(output).metadata();

    expect(metadata.width).toBe(320);
    expect(metadata.height).toBe(180);
    expect(metadata.format).toBe('png');
    expect(output.equals(input)).toBe(false);
  });

  it('does not invoke an SVG element supplied as watermark text', async () => {
    const input = await sharp({
      create: { width: 120, height: 80, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();

    await expect(
      addWaterMarkToIMG(input, '<image href="file:///etc/passwd"/>'),
    ).resolves.toBeInstanceOf(Buffer);
  });
});
