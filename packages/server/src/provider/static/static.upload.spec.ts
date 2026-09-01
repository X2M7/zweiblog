import { compressImgToWebp } from 'src/utils/webp';
import { readSafeImageMetadata } from 'src/utils/imageMetadata';
import { StaticProvider } from './static.provider';

jest.mock('src/utils/webp', () => ({
  compressImgToWebp: jest.fn(),
}));

const mockedCompressImgToWebp = jest.mocked(compressImgToWebp);

function gifBuffer() {
  return Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');
}

function pngBuffer() {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(2, 16);
  buffer.writeUInt32BE(3, 20);
  return buffer;
}

function webpBuffer() {
  const buffer = Buffer.alloc(30);
  buffer.write('RIFF', 0, 'ascii');
  buffer.write('WEBP', 8, 'ascii');
  buffer.write('VP8X', 12, 'ascii');
  buffer[24] = 1;
  buffer[27] = 2;
  return buffer;
}

function createProvider(enableWebp = true, enableWaterMark = false) {
  const provider = new StaticProvider(
    {} as any,
    {
      getStaticSetting: jest
        .fn()
        .mockResolvedValue({ storageType: 'local', enableWebp, enableWaterMark }),
    } as any,
    {} as any,
    {} as any,
    {} as any,
  );
  jest.spyOn(provider, 'getOneBySign').mockResolvedValue(null);
  jest.spyOn(provider, 'saveFile').mockImplementation(async (_type, fileName) => {
    return `/static/img/${fileName}`;
  });
  return provider;
}

describe('StaticProvider image upload conversion', () => {
  beforeEach(() => {
    mockedCompressImgToWebp.mockReset();
  });

  it('preserves a GIF instead of sending it to cwebp', async () => {
    const provider = createProvider();
    const buffer = gifBuffer();

    const result = await provider.upload({ buffer, originalname: 'animation.gif' }, 'img');

    expect(mockedCompressImgToWebp).not.toHaveBeenCalled();
    expect(provider.saveFile).toHaveBeenCalledWith(
      'gif',
      expect.stringMatching(/\.gif$/),
      buffer,
      'img',
      expect.any(String),
      undefined,
    );
    expect(result.src).toMatch(/\.gif$/);
  });

  it('falls back to a validated original when optional WebP conversion fails', async () => {
    const provider = createProvider();
    const buffer = pngBuffer();
    mockedCompressImgToWebp.mockRejectedValue(new Error('cwebp is unavailable'));

    const result = await provider.upload({ buffer, originalname: 'logo.png' }, 'img');

    expect(mockedCompressImgToWebp).toHaveBeenCalledWith(buffer);
    expect(provider.saveFile).toHaveBeenCalledWith(
      'png',
      expect.stringMatching(/\.png$/),
      buffer,
      'img',
      expect.any(String),
      undefined,
    );
    expect(result.src).toMatch(/\.png$/);
  });

  it('stores a valid successful conversion as WebP', async () => {
    const provider = createProvider();
    const source = pngBuffer();
    const converted = webpBuffer();
    mockedCompressImgToWebp.mockResolvedValue(converted);

    const result = await provider.upload({ buffer: source, originalname: 'logo.png' }, 'img');

    expect(provider.saveFile).toHaveBeenCalledWith(
      'webp',
      expect.stringMatching(/\.webp$/),
      converted,
      'img',
      expect.any(String),
      undefined,
    );
    expect(result.src).toMatch(/\.webp$/);
  });

  it('does not replace a valid source when the converter resolves malformed bytes', async () => {
    const provider = createProvider();
    const buffer = pngBuffer();
    mockedCompressImgToWebp.mockResolvedValue(Buffer.from('not a WebP image'));

    const result = await provider.upload({ buffer, originalname: 'logo.png' }, 'img');

    expect(provider.saveFile).toHaveBeenCalledWith(
      'png',
      expect.stringMatching(/\.png$/),
      buffer,
      'img',
      expect.any(String),
      undefined,
    );
    expect(result.src).toMatch(/\.png$/);
  });

  it('preserves an existing WebP without recompressing it', async () => {
    const provider = createProvider();
    const buffer = webpBuffer();

    const result = await provider.upload({ buffer, originalname: 'logo.webp' }, 'img');

    expect(mockedCompressImgToWebp).not.toHaveBeenCalled();
    expect(provider.saveFile).toHaveBeenCalledWith(
      'webp',
      expect.stringMatching(/\.webp$/),
      buffer,
      'img',
      expect.any(String),
      undefined,
    );
    expect(result.src).toMatch(/\.webp$/);
  });

  it('rasterizes additional formats before storage even when optional compression is off', async () => {
    const provider = createProvider(false);
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="6"><rect width="8" height="6" fill="#369"/></svg>',
    );

    const result = await provider.upload({ buffer: svg, originalname: 'logo.svg' }, 'img');

    expect(mockedCompressImgToWebp).not.toHaveBeenCalled();
    expect(provider.saveFile).toHaveBeenCalledWith(
      'webp',
      expect.stringMatching(/\.webp$/),
      expect.any(Buffer),
      'img',
      expect.any(String),
      undefined,
    );
    expect(result.src).toMatch(/\.webp$/);
  });

  it('watermarks the normalized representation of an additional format', async () => {
    const provider = createProvider(false, true);
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="#369"/></svg>',
    );

    await provider.upload({ buffer: svg, originalname: 'logo.svg' }, 'img', false, undefined, {
      withWaterMark: true,
      waterMarkText: 'ZweiBlog',
    });

    const savedBuffer = (provider.saveFile as jest.Mock).mock.calls[0][2] as Buffer;
    expect(readSafeImageMetadata(savedBuffer)).toEqual({ type: 'webp', width: 80, height: 60 });
  });
});
