import { BadRequestException, ConflictException, PayloadTooLargeException } from '@nestjs/common';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import compressing from 'compressing';
import { config } from 'src/config';
import { customPageExportLimits, LocalProvider } from './local.provider';

describe('private image exports', () => {
  const originalStaticPath = config.staticPath;
  let root: string;
  let provider: LocalProvider;
  let cleanups: Array<() => Promise<void>>;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'zweiblog-image-export-test-'));
    config.staticPath = root;
    mkdirSync(join(root, 'img'));
    writeFileSync(join(root, 'img', 'sample.gif'), 'GIF89a-test');
    provider = new LocalProvider();
    cleanups = [];
  });
  afterEach(async () => {
    await Promise.all(cleanups.map((cleanup) => cleanup()));
    config.staticPath = originalStaticPath;
    rmSync(root, { recursive: true, force: true });
  });
  it('creates a private bounded snapshot and removes it idempotently', async () => {
    const archive = await provider.exportAllImg();
    cleanups.push(archive.cleanup);
    expect(relative(root, archive.archivePath)).toMatch(/^\.\./);
    expect(statSync(dirname(archive.archivePath)).mode & 0o777).toBe(0o700);
    expect(statSync(archive.archivePath).mode & 0o777).toBe(0o600);
    await compressing.zip.uncompress(archive.archivePath, join(root, 'unpacked'));
    expect(readFileSync(join(root, 'unpacked', 'sample.gif'), 'utf8')).toBe('GIF89a-test');
    expect(existsSync(join(root, 'export'))).toBe(false);
    await Promise.all([archive.cleanup(), archive.cleanup()]);
    expect(existsSync(dirname(archive.archivePath))).toBe(false);
  });
  it('holds the single export slot until the download is cleaned up', async () => {
    const first = await provider.exportAllImg();
    cleanups.push(first.cleanup);
    await expect(provider.exportAllImg()).rejects.toBeInstanceOf(ConflictException);
    await first.cleanup();
    const second = await provider.exportAllImg();
    cleanups.push(second.cleanup);
    expect(existsSync(second.archivePath)).toBe(true);
  });
  it('rejects symbolic links without consuming the next export slot', async () => {
    symlinkSync(join(root, 'img', 'sample.gif'), join(root, 'img', 'link.gif'));
    await expect(provider.exportAllImg()).rejects.toBeInstanceOf(BadRequestException);
    rmSync(join(root, 'img', 'link.gif'));
    const archive = await provider.exportAllImg();
    cleanups.push(archive.cleanup);
  });
  it('rejects oversized files before copying their contents', async () => {
    truncateSync(join(root, 'img', 'sample.gif'), customPageExportLimits.maxSingleFileBytes + 1);
    await expect(provider.exportAllImg()).rejects.toBeInstanceOf(PayloadTooLargeException);
  });
});
