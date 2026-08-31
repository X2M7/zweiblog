import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import compressing from 'compressing';
import { config } from 'src/config';
import { getCustomPageUploadTempRoot } from 'src/utils/customPageUpload';
import {
  accountCustomPageExportEntry,
  accountCustomPageExportFile,
  customPageExportLimits,
  LocalProvider,
} from './local.provider';

describe('LocalProvider custom-page file operations', () => {
  const originalStaticPath = config.staticPath;
  let temporaryStaticPath: string;
  let pageRoot: string;
  let provider: LocalProvider;
  let archiveCleanups: Array<() => Promise<void>>;

  beforeEach(() => {
    temporaryStaticPath = mkdtempSync(join(tmpdir(), 'zweiblog-custom-page-file-'));
    config.staticPath = temporaryStaticPath;
    pageRoot = join(temporaryStaticPath, 'customPage', 'site');
    mkdirSync(join(pageRoot, 'assets'), { recursive: true });
    provider = new LocalProvider();
    archiveCleanups = [];
  });

  afterEach(async () => {
    for (const cleanup of archiveCleanups) {
      await cleanup();
    }
    config.staticPath = originalStaticPath;
    rmSync(temporaryStaticPath, { recursive: true, force: true });
  });

  function createTemporaryUpload(name: string, size = 0) {
    const temporaryUploadRoot = getCustomPageUploadTempRoot();
    mkdirSync(temporaryUploadRoot, { recursive: true });
    const temporaryUpload = join(temporaryUploadRoot, name);
    writeFileSync(temporaryUpload, '');
    truncateSync(temporaryUpload, size);
    return temporaryUpload;
  }

  it('moves an upload larger than 10 MiB from disk without buffering it in memory', async () => {
    const size = 11 * 1024 * 1024 + 17;
    const temporaryUpload = createTemporaryUpload('large-upload', size);

    await expect(
      provider.saveUploadedCustomPageFile('/site', 'assets/large.bin', temporaryUpload, size),
    ).resolves.toMatchObject({
      realPath: '/c/site/assets/large.bin',
    });

    expect(existsSync(temporaryUpload)).toBe(false);
    expect(statSync(join(pageRoot, 'assets', 'large.bin')).size).toBe(size);
  });

  it('accepts a long, deeply nested safe upload path', async () => {
    const nestedPath = `${Array.from(
      { length: 40 },
      (_, index) => `directory-${index.toString().padStart(2, '0')}`,
    ).join('/')}/app.js`;
    const temporaryUpload = createTemporaryUpload('nested-upload', 37);

    await expect(
      provider.saveUploadedCustomPageFile('/site', nestedPath, temporaryUpload, 37),
    ).resolves.toMatchObject({
      realPath: `/c/site/${nestedPath}`,
    });

    expect(Buffer.byteLength(nestedPath, 'utf-8')).toBeGreaterThan(255);
    expect(statSync(join(pageRoot, ...nestedPath.split('/'))).size).toBe(37);
  });

  it.each(['../outside.bin', 'assets/../../outside.bin', '..\\outside.bin'])(
    'rejects upload path traversal and leaves the temporary file in place: %s',
    async (filePath) => {
      const temporaryUpload = createTemporaryUpload(`traversal-${Math.random()}`, 13);

      await expect(
        provider.saveUploadedCustomPageFile('/site', filePath, temporaryUpload, 13),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(existsSync(temporaryUpload)).toBe(true);
      expect(existsSync(join(temporaryStaticPath, 'customPage', 'outside.bin'))).toBe(false);
    },
  );

  it('rejects a symbolic-link destination component without touching its target', async () => {
    const outsideRoot = mkdtempSync(join(tmpdir(), 'zweiblog-custom-page-upload-outside-'));
    const outsideFile = join(outsideRoot, 'secret.txt');
    const temporaryUpload = createTemporaryUpload('symlink-upload', 23);
    writeFileSync(outsideFile, 'outside');

    try {
      symlinkSync(outsideRoot, join(pageRoot, 'linked'), 'junction');
      await expect(
        provider.saveUploadedCustomPageFile('/site', 'linked/secret.txt', temporaryUpload, 23),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(existsSync(temporaryUpload)).toBe(true);
      expect(readFileSync(outsideFile, 'utf-8')).toBe('outside');
    } finally {
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  it('renames a nested file without moving it and preserves its extension and content', async () => {
    const source = join(pageRoot, 'assets', 'app.min.js');
    const destination = join(pageRoot, 'assets', 'bundle.min.js');
    writeFileSync(source, 'console.log("kept");');

    await expect(
      provider.renameCustomPageFile('/site', 'assets/app.min.js', 'bundle.min'),
    ).resolves.toEqual({
      filePath: 'assets/bundle.min.js',
      oldFilePath: 'assets/app.min.js',
    });

    expect(existsSync(source)).toBe(false);
    expect(readFileSync(destination, 'utf-8')).toBe('console.log("kept");');
  });

  it('deletes only the selected file', async () => {
    const selected = join(pageRoot, 'assets', 'selected.css');
    const sibling = join(pageRoot, 'assets', 'sibling.css');
    writeFileSync(selected, 'selected');
    writeFileSync(sibling, 'sibling');

    await expect(provider.deleteCustomPageFile('/site', 'assets/selected.css')).resolves.toEqual({
      filePath: 'assets/selected.css',
      deleted: true,
    });

    expect(existsSync(selected)).toBe(false);
    expect(readFileSync(sibling, 'utf-8')).toBe('sibling');
  });

  it('rejects a rename collision without overwriting either file', async () => {
    const source = join(pageRoot, 'assets', 'app.js');
    const destination = join(pageRoot, 'assets', 'taken.js');
    writeFileSync(source, 'source');
    writeFileSync(destination, 'destination');

    await expect(
      provider.renameCustomPageFile('/site', 'assets/app.js', 'taken'),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(readFileSync(source, 'utf-8')).toBe('source');
    expect(readFileSync(destination, 'utf-8')).toBe('destination');
  });

  it.each(['../outside.js', '..\\outside.js'])(
    'rejects traversal and leaves the outside file untouched: %s',
    async (filePath) => {
      const outside = join(temporaryStaticPath, 'customPage', 'outside.js');
      writeFileSync(outside, 'outside');

      await expect(provider.deleteCustomPageFile('/site', filePath)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(readFileSync(outside, 'utf-8')).toBe('outside');
    },
  );

  it('rejects symbolic-link components and leaves the linked file untouched', async () => {
    const outsideRoot = mkdtempSync(join(tmpdir(), 'zweiblog-custom-page-outside-'));
    const outsideFile = join(outsideRoot, 'secret.js');
    writeFileSync(outsideFile, 'outside');

    try {
      symlinkSync(outsideRoot, join(pageRoot, 'linked'), 'junction');
      await expect(
        provider.deleteCustomPageFile('/site', 'linked/secret.js'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(readFileSync(outsideFile, 'utf-8')).toBe('outside');
    } finally {
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  it('rejects directories and missing files', async () => {
    await expect(provider.deleteCustomPageFile('/site', 'assets')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      provider.deleteCustomPageFile('/site', 'assets/missing.js'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([
    '',
    ' ',
    ' leading',
    'trailing ',
    '.',
    '..',
    'nested/name',
    'nested\\name',
    'bad:name',
    'bad\nname',
    'trailing.',
    'CON',
    'con.config',
    'LPT9',
  ])('rejects an invalid new base name: %p', async (newBaseName) => {
    writeFileSync(join(pageRoot, 'assets', 'app.js'), 'source');

    await expect(
      provider.renameCustomPageFile('/site', 'assets/app.js', newBaseName),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(readFileSync(join(pageRoot, 'assets', 'app.js'), 'utf-8')).toBe('source');
  });

  it('rejects a final file name longer than 255 UTF-8 bytes', async () => {
    writeFileSync(join(pageRoot, 'assets', 'app.js'), 'source');

    await expect(
      provider.renameCustomPageFile('/site', 'assets/app.js', '界'.repeat(85)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('supports extensionless dot files', async () => {
    writeFileSync(join(pageRoot, '.env'), 'SECRET=value');

    await expect(provider.renameCustomPageFile('/site', '.env', '.settings')).resolves.toEqual({
      filePath: '.settings',
      oldFilePath: '.env',
    });
    expect(readFileSync(join(pageRoot, '.settings'), 'utf-8')).toBe('SECRET=value');
  });

  it('exports a single-file page as index.html at the ZIP root', async () => {
    const archive = await provider.exportCustomPageProject(
      '/single',
      'file',
      '<!doctype html><title>Single</title>',
    );
    archiveCleanups.push(archive.cleanup);
    const extracted = join(temporaryStaticPath, 'single-export');
    mkdirSync(extracted);

    await compressing.zip.uncompress(archive.archivePath, extracted);

    expect(readFileSync(join(extracted, 'index.html'), 'utf-8')).toBe(
      '<!doctype html><title>Single</title>',
    );
    expect(existsSync(join(extracted, 'project', 'index.html'))).toBe(false);
  });

  it('exports every regular file in a multi-file page with its relative path', async () => {
    mkdirSync(join(pageRoot, 'styles'), { recursive: true });
    mkdirSync(join(pageRoot, 'empty', 'nested'), { recursive: true });
    writeFileSync(join(pageRoot, 'index.html'), '<main>Project</main>');
    writeFileSync(join(pageRoot, 'assets', 'app.js'), 'console.log("project")');
    writeFileSync(join(pageRoot, 'styles', 'app.css'), 'main { display: block; }');
    writeFileSync(join(pageRoot, '.projectrc'), 'local=true');
    const archive = await provider.exportCustomPageProject('/site', 'folder');
    archiveCleanups.push(archive.cleanup);
    const extracted = join(temporaryStaticPath, 'folder-export');
    mkdirSync(extracted);

    await compressing.zip.uncompress(archive.archivePath, extracted);

    expect(readFileSync(join(extracted, 'index.html'), 'utf-8')).toBe('<main>Project</main>');
    expect(readFileSync(join(extracted, 'assets', 'app.js'), 'utf-8')).toBe(
      'console.log("project")',
    );
    expect(readFileSync(join(extracted, 'styles', 'app.css'), 'utf-8')).toBe(
      'main { display: block; }',
    );
    expect(readFileSync(join(extracted, '.projectrc'), 'utf-8')).toBe('local=true');
    expect(statSync(join(extracted, 'empty', 'nested')).isDirectory()).toBe(true);
    expect(readdirSync(join(extracted, 'empty', 'nested'))).toEqual([]);
  });

  it('allows two isolated exports, rejects a third, and releases capacity on cleanup', async () => {
    writeFileSync(join(pageRoot, 'index.html'), '<main>Concurrent</main>');

    const firstPromise = provider.exportCustomPageProject('/site', 'folder');
    const secondPromise = provider.exportCustomPageProject('/site', 'folder');
    await expect(provider.exportCustomPageProject('/site', 'folder')).rejects.toBeInstanceOf(
      ConflictException,
    );
    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    archiveCleanups.push(first.cleanup, second.cleanup);

    expect(first.archivePath).not.toBe(second.archivePath);
    expect(existsSync(first.archivePath)).toBe(true);
    expect(existsSync(second.archivePath)).toBe(true);
    await first.cleanup();
    await first.cleanup();
    expect(existsSync(first.archivePath)).toBe(false);
    expect(existsSync(second.archivePath)).toBe(true);

    const third = await provider.exportCustomPageProject('/site', 'folder');
    archiveCleanups.push(third.cleanup);
    expect(existsSync(third.archivePath)).toBe(true);
  });

  it('rejects a symlink anywhere in a multi-file page export', async () => {
    const outsideRoot = mkdtempSync(join(tmpdir(), 'zweiblog-custom-page-export-outside-'));
    const outsideFile = join(outsideRoot, 'secret.txt');
    writeFileSync(outsideFile, 'outside');

    try {
      symlinkSync(outsideRoot, join(pageRoot, 'linked'), 'junction');
      await expect(provider.exportCustomPageProject('/site', 'folder')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(readFileSync(outsideFile, 'utf-8')).toBe('outside');
    } finally {
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  it('enforces file-count and total-uncompressed-size export budgets', () => {
    expect(() =>
      accountCustomPageExportFile(
        {
          entries: 0,
          files: customPageExportLimits.maxFiles,
          uncompressedBytes: 0,
        },
        0,
      ),
    ).toThrow(PayloadTooLargeException);
    expect(() =>
      accountCustomPageExportFile(
        {
          entries: 0,
          files: 1,
          uncompressedBytes: customPageExportLimits.maxUncompressedBytes,
        },
        1,
      ),
    ).toThrow(PayloadTooLargeException);
  });

  it('counts empty directories toward the maximum project entry budget', () => {
    const budget = {
      entries: customPageExportLimits.maxEntries,
      files: 0,
      uncompressedBytes: 0,
    };

    expect(() => accountCustomPageExportEntry(budget)).toThrow(PayloadTooLargeException);
  });

  it('rejects an oversized single file before reading it into memory', async () => {
    const oversized = join(pageRoot, 'oversized.bin');
    writeFileSync(oversized, '');
    truncateSync(oversized, customPageExportLimits.maxSingleFileBytes + 1);

    await expect(provider.exportCustomPageProject('/site', 'folder')).rejects.toBeInstanceOf(
      PayloadTooLargeException,
    );
  });

  it('rejects a project nested beyond the export depth limit', async () => {
    let directory = pageRoot;
    for (let depth = 0; depth <= customPageExportLimits.maxDepth; depth += 1) {
      directory = join(directory, 'd');
      mkdirSync(directory);
    }

    await expect(provider.exportCustomPageProject('/site', 'folder')).rejects.toBeInstanceOf(
      PayloadTooLargeException,
    );
  });

  it('recursively deletes only the selected subfolder', async () => {
    mkdirSync(join(pageRoot, 'remove', 'nested'), { recursive: true });
    mkdirSync(join(pageRoot, 'keep'), { recursive: true });
    writeFileSync(join(pageRoot, 'remove', 'nested', 'file.txt'), 'remove');
    writeFileSync(join(pageRoot, 'keep', 'file.txt'), 'keep');

    await expect(provider.deleteCustomPageSubfolder('/site', 'remove')).resolves.toEqual({
      folderPath: 'remove',
      deleted: true,
    });

    expect(existsSync(join(pageRoot, 'remove'))).toBe(false);
    expect(readFileSync(join(pageRoot, 'keep', 'file.txt'), 'utf-8')).toBe('keep');
  });

  it('deletes a whole custom-page folder and treats an already-missing folder as absent', async () => {
    writeFileSync(join(pageRoot, 'index.html'), 'project');

    await expect(provider.deleteCustomPageFolder('/site')).resolves.toBeUndefined();
    expect(existsSync(pageRoot)).toBe(false);
    await expect(provider.deleteCustomPageFolder('/site')).resolves.toBeUndefined();
  });

  it('rejects deleting the page root, traversal, a file, or a missing folder', async () => {
    writeFileSync(join(pageRoot, 'assets', 'app.js'), 'source');

    await expect(provider.deleteCustomPageSubfolder('/site', '')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(provider.deleteCustomPageSubfolder('/site', '../outside')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      provider.deleteCustomPageSubfolder('/site', 'assets/app.js'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(provider.deleteCustomPageSubfolder('/site', 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects a symlink target and removes an inner link without touching its target', async () => {
    const outsideRoot = mkdtempSync(join(tmpdir(), 'zweiblog-custom-page-delete-outside-'));
    writeFileSync(join(outsideRoot, 'secret.txt'), 'outside');
    mkdirSync(join(pageRoot, 'remove'));

    try {
      symlinkSync(outsideRoot, join(pageRoot, 'linked'), 'junction');
      symlinkSync(outsideRoot, join(pageRoot, 'remove', 'linked'), 'junction');
      await expect(provider.deleteCustomPageSubfolder('/site', 'linked')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(provider.deleteCustomPageSubfolder('/site', 'remove')).resolves.toEqual({
        folderPath: 'remove',
        deleted: true,
      });
      expect(existsSync(join(pageRoot, 'remove'))).toBe(false);
      expect(readFileSync(join(outsideRoot, 'secret.txt'), 'utf-8')).toBe('outside');
    } finally {
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });
});
