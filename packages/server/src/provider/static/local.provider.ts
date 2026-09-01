import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { StaticType, StoragePath } from 'src/types/setting.dto';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'node:os';
import { pipeline } from 'node:stream/promises';
import { config } from 'src/config';
import { formatBytes } from 'src/utils/size';
import { ImgMeta } from 'src/types/img';
import { isProd } from 'src/utils/isProd';
import compressing from 'compressing';
import dayjs from 'dayjs';
import { checkOrCreate, checkOrCreateByFilePath } from 'src/utils/checkFolder';
import { readDirs } from 'src/utils/readFileList';
import { checkOrCreateFile } from 'src/utils/checkFile';
import {
  normalizeManagedPath,
  relativePathFromRoot,
  resolvePathWithinRoot,
} from 'src/utils/safePath';
import { readSafeImageMetadata } from 'src/utils/imageMetadata';
import { assertCustomPageTemporaryUpload } from 'src/utils/customPageUpload';
import { randomUUID } from 'node:crypto';
import {
  CUSTOM_PAGE_MAX_PATH_BYTES,
  CUSTOM_PAGE_MAX_PATH_SEGMENTS,
} from 'src/utils/customPagePathLimits';

const yazl: any = require('yazl');

const INVALID_CUSTOM_PAGE_FILE_NAME = /[<>:"/\\|?*\u0000-\u001f\u007f]/;
const WINDOWS_RESERVED_FILE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const CUSTOM_PAGE_EXPORT_TEMP_PREFIX = 'zweiblog-custom-page-export-';
const INVALID_ARCHIVE_ENTRY_NAME = /[/\\\u0000-\u001f\u007f]/;
const MAX_CONCURRENT_CUSTOM_PAGE_EXPORTS = 2;
const CUSTOM_PAGE_EXPORT_COPY_CHUNK_BYTES = 64 * 1024;

export const customPageExportLimits = {
  maxEntries: 10_000,
  maxFiles: 10_000,
  maxDepth: 64,
  maxUncompressedBytes: 512 * 1024 * 1024,
  maxSingleFileBytes: 256 * 1024 * 1024,
} as const;

export interface CustomPageExportBudget {
  entries: number;
  files: number;
  uncompressedBytes: number;
}

export interface CustomPageArchive {
  archivePath: string;
  cleanup: () => Promise<void>;
}

function getValidatedCustomPageFileName(newBaseName: string, extension: string) {
  if (
    typeof newBaseName !== 'string' ||
    !newBaseName ||
    newBaseName.trim() !== newBaseName ||
    newBaseName === '.' ||
    newBaseName === '..' ||
    newBaseName.endsWith('.') ||
    INVALID_CUSTOM_PAGE_FILE_NAME.test(newBaseName) ||
    WINDOWS_RESERVED_FILE_NAME.test(newBaseName.split('.')[0])
  ) {
    throw new BadRequestException('Invalid file name');
  }

  const fileName = `${newBaseName}${extension}`;
  if (Buffer.byteLength(fileName, 'utf-8') > 255) {
    throw new BadRequestException('File name is too long');
  }
  return fileName;
}

function validateCustomPageUploadPath(filePath: string) {
  if (
    typeof filePath !== 'string' ||
    !filePath ||
    Buffer.byteLength(filePath, 'utf-8') > CUSTOM_PAGE_MAX_PATH_BYTES
  ) {
    throw new BadRequestException('Invalid custom page file path');
  }
  const segments = filePath.replace(/\\/g, '/').split('/');
  if (!segments.length || segments.length > CUSTOM_PAGE_MAX_PATH_SEGMENTS) {
    throw new BadRequestException('Invalid custom page file path');
  }
  for (const segment of segments) {
    if (
      !segment ||
      segment === '.' ||
      segment === '..' ||
      segment.endsWith('.') ||
      segment.endsWith(' ') ||
      Buffer.byteLength(segment, 'utf-8') > 255 ||
      INVALID_CUSTOM_PAGE_FILE_NAME.test(segment) ||
      WINDOWS_RESERVED_FILE_NAME.test(segment.split('.')[0])
    ) {
      throw new BadRequestException('Invalid custom page file path');
    }
  }
  return segments.join('/');
}

export function accountCustomPageExportFile(budget: CustomPageExportBudget, fileSize: number) {
  if (!Number.isSafeInteger(fileSize) || fileSize < 0) {
    throw new BadRequestException('Custom page project contains an invalid file size');
  }
  if (fileSize > customPageExportLimits.maxSingleFileBytes) {
    throw new PayloadTooLargeException('A custom page file is too large to export');
  }
  if (budget.files + 1 > customPageExportLimits.maxFiles) {
    throw new PayloadTooLargeException('Custom page project contains too many files');
  }
  if (budget.uncompressedBytes + fileSize > customPageExportLimits.maxUncompressedBytes) {
    throw new PayloadTooLargeException('Custom page project is too large to export');
  }
  budget.files += 1;
  budget.uncompressedBytes += fileSize;
}

export function accountCustomPageExportEntry(budget: CustomPageExportBudget) {
  if (budget.entries + 1 > customPageExportLimits.maxEntries) {
    throw new PayloadTooLargeException('Custom page project contains too many entries');
  }
  budget.entries += 1;
}

async function copyRegularFileWithoutFollowingLinks(
  sourcePath: string,
  destinationPath: string,
  expectedSize: number,
) {
  let sourceHandle: Awaited<ReturnType<typeof fs.promises.open>> | undefined;
  let destinationHandle: Awaited<ReturnType<typeof fs.promises.open>> | undefined;
  try {
    const noFollow = fs.constants.O_NOFOLLOW || 0;
    sourceHandle = await fs.promises.open(sourcePath, fs.constants.O_RDONLY | noFollow);
    const descriptorStat = await sourceHandle.stat();
    const pathStat = await fs.promises.lstat(sourcePath);
    if (
      !descriptorStat.isFile() ||
      !pathStat.isFile() ||
      descriptorStat.size !== expectedSize ||
      descriptorStat.dev !== pathStat.dev ||
      descriptorStat.ino !== pathStat.ino
    ) {
      throw new BadRequestException('Custom page project contains an unsafe file');
    }

    destinationHandle = await fs.promises.open(destinationPath, 'wx', 0o600);
    const chunk = Buffer.allocUnsafe(CUSTOM_PAGE_EXPORT_COPY_CHUNK_BYTES);
    let sourceOffset = 0;
    while (sourceOffset < expectedSize) {
      const requestedBytes = Math.min(chunk.byteLength, expectedSize - sourceOffset);
      const { bytesRead } = await sourceHandle.read(chunk, 0, requestedBytes, sourceOffset);
      if (!bytesRead) {
        throw new BadRequestException('Custom page project changed during export');
      }
      let writtenBytes = 0;
      while (writtenBytes < bytesRead) {
        const result = await destinationHandle.write(
          chunk,
          writtenBytes,
          bytesRead - writtenBytes,
          sourceOffset + writtenBytes,
        );
        if (!result.bytesWritten) {
          throw new BadRequestException('Custom page export could not copy a file');
        }
        writtenBytes += result.bytesWritten;
      }
      sourceOffset += bytesRead;
    }

    const finalStat = await sourceHandle.stat();
    if (
      finalStat.size !== descriptorStat.size ||
      finalStat.mtimeMs !== descriptorStat.mtimeMs ||
      finalStat.ctimeMs !== descriptorStat.ctimeMs
    ) {
      throw new BadRequestException('Custom page project changed during export');
    }
  } catch (error) {
    if (error instanceof BadRequestException) {
      throw error;
    }
    if (['ELOOP', 'ENOENT', 'EINVAL'].includes((error as NodeJS.ErrnoException)?.code || '')) {
      throw new BadRequestException('Custom page project contains an unsafe file');
    }
    throw error;
  } finally {
    await Promise.allSettled([sourceHandle?.close(), destinationHandle?.close()].filter(Boolean));
  }
}

function assertSafeArchiveEntryName(name: string) {
  if (!name || name === '.' || name === '..' || INVALID_ARCHIVE_ENTRY_NAME.test(name)) {
    throw new BadRequestException('Custom page project contains an invalid file name');
  }
}

async function copyCustomPageTreeWithoutLinks(
  sourceRoot: string,
  sourceDirectory: string,
  destinationDirectory: string,
  budget: CustomPageExportBudget,
  depth = 0,
) {
  if (depth > customPageExportLimits.maxDepth) {
    throw new PayloadTooLargeException('Custom page project is nested too deeply');
  }
  const relativeDirectory = relativePathFromRoot(sourceRoot, sourceDirectory);
  const checkedDirectory = resolvePathWithinRoot(sourceRoot, relativeDirectory);
  const directoryStat = await fs.promises.lstat(checkedDirectory);
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
    throw new BadRequestException('Custom page project contains an unsafe directory');
  }

  const entries = await fs.promises.readdir(checkedDirectory, { withFileTypes: true });
  for (const entry of entries) {
    assertSafeArchiveEntryName(entry.name);
    accountCustomPageExportEntry(budget);
    const sourcePath = path.join(checkedDirectory, entry.name);
    const destinationPath = path.join(destinationDirectory, entry.name);
    const entryStat = await fs.promises.lstat(sourcePath);
    if (entryStat.isSymbolicLink()) {
      throw new BadRequestException('Symbolic links are not allowed in custom page exports');
    }
    if (entryStat.isDirectory()) {
      await fs.promises.mkdir(destinationPath, { mode: 0o700 });
      await copyCustomPageTreeWithoutLinks(
        sourceRoot,
        sourcePath,
        destinationPath,
        budget,
        depth + 1,
      );
      continue;
    }
    if (!entryStat.isFile()) {
      throw new BadRequestException('Custom page project contains an unsupported file type');
    }

    accountCustomPageExportFile(budget, entryStat.size);
    await copyRegularFileWithoutFollowingLinks(sourcePath, destinationPath, entryStat.size);
  }
}

function createCustomPageExportTempDirectory() {
  const temporaryRoot = path.resolve(tmpdir());
  const exportDirectory = fs.mkdtempSync(path.join(temporaryRoot, CUSTOM_PAGE_EXPORT_TEMP_PREFIX));
  try {
    fs.chmodSync(exportDirectory, 0o700);
  } catch {
    // Windows ACLs are inherited from the user's temporary directory.
  }
  return exportDirectory;
}

async function removeCustomPageExportTempDirectory(exportDirectory: string) {
  const temporaryRoot = path.resolve(tmpdir());
  const resolvedExportDirectory = path.resolve(exportDirectory);
  const relative = path.relative(temporaryRoot, resolvedExportDirectory);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative) ||
    !path.basename(resolvedExportDirectory).startsWith(CUSTOM_PAGE_EXPORT_TEMP_PREFIX)
  ) {
    throw new BadRequestException('Invalid custom page export directory');
  }
  await fs.promises.rm(resolvedExportDirectory, { recursive: true, force: true });
}

async function addSnapshotEntriesToZip(zipFile: any, root: string, directory: string) {
  const entries = await fs.promises.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    const relativeEntryPath = relativePathFromRoot(root, entryPath);
    const entryStat = await fs.promises.lstat(entryPath);
    if (entryStat.isSymbolicLink()) {
      throw new BadRequestException('Symbolic links are not allowed in custom page exports');
    }
    if (entryStat.isDirectory()) {
      zipFile.addEmptyDirectory(relativeEntryPath, {
        mode: entryStat.mode,
        mtime: entryStat.mtime,
      });
      await addSnapshotEntriesToZip(zipFile, root, entryPath);
      continue;
    }
    if (!entryStat.isFile()) {
      throw new BadRequestException('Custom page export contains an unsupported entry');
    }
    zipFile.addFile(entryPath, relativeEntryPath, {
      mode: entryStat.mode,
      mtime: entryStat.mtime,
    });
  }
}

async function createCustomPageZip(projectDirectory: string, archivePath: string) {
  const zipFile = new yazl.ZipFile();
  const archiveStream = fs.createWriteStream(archivePath, { flags: 'wx', mode: 0o600 });
  zipFile.on('error', (error: Error) => {
    zipFile.outputStream.destroy(error);
  });
  const pipelinePromise = pipeline(zipFile.outputStream, archiveStream);
  void pipelinePromise.catch(() => undefined);

  try {
    await addSnapshotEntriesToZip(zipFile, projectDirectory, projectDirectory);
    zipFile.end();
    await pipelinePromise;
  } catch (error) {
    zipFile.outputStream.destroy(error as Error);
    archiveStream.destroy(error as Error);
    await pipelinePromise.catch(() => undefined);
    throw error;
  }
}

@Injectable()
export class LocalProvider {
  private activeCustomPageExports = 0;

  private getStorageRoot(type: StaticType) {
    return path.join(config.staticPath, StoragePath[type] || StoragePath.img);
  }

  async saveFile(fileName: string, buffer: Buffer, type: StaticType, toRootPath?: boolean) {
    if (type == 'img') {
      return await this.saveImg(fileName, buffer, type, toRootPath);
    } else if (type == 'customPage') {
      const storagePath = StoragePath.customPage;
      const storageRoot = this.getStorageRoot(type);
      const srcPath = resolvePathWithinRoot(storageRoot, fileName);
      const realName = relativePathFromRoot(storageRoot, srcPath);
      // 创建文件夹。
      const byteLength = buffer.byteLength;
      const realPath = `/c/${realName}`;
      checkOrCreateByFilePath(srcPath);
      fs.writeFileSync(srcPath, buffer);
      const meta = { size: formatBytes(byteLength) };
      return {
        meta,
        realPath,
      };
    }
  }

  async saveUploadedCustomPageFile(
    pathname: string,
    filePath: string,
    temporaryPath: string,
    reportedSize?: number,
  ) {
    const temporary = assertCustomPageTemporaryUpload(temporaryPath);
    if (
      reportedSize !== undefined &&
      (!Number.isSafeInteger(reportedSize) || reportedSize < 0 || reportedSize !== temporary.size)
    ) {
      throw new BadRequestException('Uploaded file size changed unexpectedly');
    }

    const storageRoot = this.getStorageRoot('customPage');
    const pageRoot = resolvePathWithinRoot(storageRoot, pathname);
    if (relativePathFromRoot(storageRoot, pageRoot) === '') {
      throw new BadRequestException('Invalid custom page path');
    }
    await fs.promises.mkdir(pageRoot, { recursive: true, mode: 0o700 });

    const normalizedFilePath = validateCustomPageUploadPath(filePath);
    let destination = resolvePathWithinRoot(pageRoot, normalizedFilePath);
    await fs.promises.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    // Re-resolve after creating directories so any unexpected symbolic-link
    // component is caught before the temporary file is moved.
    destination = resolvePathWithinRoot(pageRoot, normalizedFilePath);
    if (fs.existsSync(destination) && !fs.lstatSync(destination).isFile()) {
      throw new BadRequestException('The custom page upload target must be a regular file');
    }

    const stagingName = `.${path.basename(destination)}.upload-${randomUUID()}`;
    const stagingPath = resolvePathWithinRoot(pageRoot, path.dirname(normalizedFilePath), stagingName);
    await fs.promises.rename(temporary.path, stagingPath);
    try {
      await fs.promises.chmod(stagingPath, 0o600).catch(() => undefined);
      try {
        await fs.promises.rename(stagingPath, destination);
      } catch (error) {
        // POSIX replaces an existing regular file atomically. Windows may
        // reject that operation, so preserve the old file while replacing it.
        if (!['EEXIST', 'EPERM', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code || '')) {
          throw error;
        }
        const backupPath = resolvePathWithinRoot(
          pageRoot,
          path.dirname(normalizedFilePath),
          `.${path.basename(destination)}.backup-${randomUUID()}`,
        );
        await fs.promises.rename(destination, backupPath);
        try {
          await fs.promises.rename(stagingPath, destination);
          await fs.promises.rm(backupPath, { force: true });
        } catch (replacementError) {
          await fs.promises.rename(backupPath, destination).catch(() => undefined);
          throw replacementError;
        }
      }
    } finally {
      await fs.promises.rm(stagingPath, { force: true }).catch(() => undefined);
    }

    return {
      meta: { size: formatBytes(temporary.size) },
      realPath: `/c/${relativePathFromRoot(storageRoot, destination)}`,
    };
  }

  async getFolderFiles(p: string) {
    const storageRoot = this.getStorageRoot('customPage');
    const absPath = resolvePathWithinRoot(storageRoot, p);
    const res = readDirs(absPath, absPath);
    return res;
  }
  async createFile(p: string, subPath: string) {
    const storageRoot = this.getStorageRoot('customPage');
    const absPath = resolvePathWithinRoot(storageRoot, p, subPath || '');
    checkOrCreateFile(absPath);
  }
  async createFolder(p: string, subPath: string) {
    const storageRoot = this.getStorageRoot('customPage');
    const absPath = resolvePathWithinRoot(storageRoot, p, subPath || '');
    checkOrCreate(absPath);
  }
  async getFileContent(p: string, subPath: string) {
    const storageRoot = this.getStorageRoot('customPage');
    const absPath = resolvePathWithinRoot(storageRoot, p, subPath || '');

    const r = fs.readFileSync(absPath, { encoding: 'utf-8' });
    return r;
  }
  async updateCustomPageFileContent(pathname: string, filePath: string, content: string) {
    const storageRoot = this.getStorageRoot('customPage');
    const absPath = resolvePathWithinRoot(storageRoot, pathname, filePath);
    fs.writeFileSync(absPath, content, { encoding: 'utf-8' });
  }

  private getCustomPageFolderRoot(pathname: string) {
    const storageRoot = this.getStorageRoot('customPage');
    const pageRoot = resolvePathWithinRoot(storageRoot, pathname);
    if (relativePathFromRoot(storageRoot, pageRoot) === '') {
      throw new BadRequestException('Invalid custom page path');
    }
    if (!fs.existsSync(pageRoot)) {
      throw new NotFoundException('Custom page folder not found');
    }
    if (!fs.lstatSync(pageRoot).isDirectory()) {
      throw new BadRequestException('Custom page path must be a folder');
    }
    return pageRoot;
  }

  private getCustomPageFileTarget(pathname: string, filePath: string) {
    const pageRoot = this.getCustomPageFolderRoot(pathname);

    const target = resolvePathWithinRoot(pageRoot, filePath);
    const relativeFilePath = relativePathFromRoot(pageRoot, target);
    if (!relativeFilePath) {
      throw new BadRequestException('A file path is required');
    }
    if (!fs.existsSync(target)) {
      throw new NotFoundException('Custom page file not found');
    }
    if (!fs.lstatSync(target).isFile()) {
      throw new BadRequestException('The target must be a file');
    }

    return { pageRoot, target, relativeFilePath };
  }

  async renameCustomPageFile(pathname: string, filePath: string, newBaseName: string) {
    const { pageRoot, target, relativeFilePath } = this.getCustomPageFileTarget(pathname, filePath);
    const currentFileName = path.basename(target);
    const extension = path.extname(currentFileName);
    const newFileName = getValidatedCustomPageFileName(newBaseName, extension);
    const parentPath = relativePathFromRoot(pageRoot, path.dirname(target));
    const destination = resolvePathWithinRoot(pageRoot, parentPath, newFileName);
    const destinationFilePath = relativePathFromRoot(pageRoot, destination);

    if (destination === target) {
      return { filePath: destinationFilePath };
    }
    if (fs.existsSync(destination)) {
      let isSameFile = false;
      try {
        isSameFile = fs.realpathSync(destination) === fs.realpathSync(target);
      } catch {
        isSameFile = false;
      }
      if (!isSameFile) {
        throw new ConflictException('A file with the same name already exists');
      }
    }

    fs.renameSync(target, destination);
    return { filePath: destinationFilePath, oldFilePath: relativeFilePath };
  }

  async deleteCustomPageFile(pathname: string, filePath: string) {
    const { target, relativeFilePath } = this.getCustomPageFileTarget(pathname, filePath);
    fs.unlinkSync(target);
    return { filePath: relativeFilePath, deleted: true };
  }

  async deleteCustomPageSubfolder(pathname: string, folderPath: string) {
    const pageRoot = this.getCustomPageFolderRoot(pathname);
    const target = resolvePathWithinRoot(pageRoot, folderPath);
    const relativeFolderPath = relativePathFromRoot(pageRoot, target);
    if (!relativeFolderPath) {
      throw new BadRequestException('The custom page root cannot be deleted');
    }
    if (!fs.existsSync(target)) {
      throw new NotFoundException('Custom page folder not found');
    }
    const targetStat = fs.lstatSync(target);
    if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) {
      throw new BadRequestException('The target must be a real directory');
    }

    await fs.promises.rm(target, { recursive: true, force: false });
    return { folderPath: relativeFolderPath, deleted: true };
  }

  async exportCustomPageProject(
    pathname: string,
    type: 'file' | 'folder',
    html?: string,
  ): Promise<CustomPageArchive> {
    if (type !== 'file' && type !== 'folder') {
      throw new BadRequestException('Invalid custom page type');
    }
    if (this.activeCustomPageExports >= MAX_CONCURRENT_CUSTOM_PAGE_EXPORTS) {
      throw new ConflictException('Too many custom page exports are already running');
    }
    this.activeCustomPageExports += 1;

    let exportDirectory: string;
    try {
      exportDirectory = createCustomPageExportTempDirectory();
    } catch (error) {
      this.activeCustomPageExports -= 1;
      throw error;
    }
    let completed = false;
    const cleanup = (() => {
      let cleaned = false;
      let cleanupPromise: Promise<void> | undefined;
      return async () => {
        if (cleaned) return;
        if (cleanupPromise) return cleanupPromise;
        cleanupPromise = removeCustomPageExportTempDirectory(exportDirectory)
          .then(() => {
            cleaned = true;
            this.activeCustomPageExports -= 1;
          })
          .finally(() => {
            cleanupPromise = undefined;
          });
        return cleanupPromise;
      };
    })();

    try {
      const projectDirectory = path.join(exportDirectory, 'project');
      const archivePath = path.join(exportDirectory, 'project.zip');
      await fs.promises.mkdir(projectDirectory, { mode: 0o700 });

      if (type === 'file') {
        const htmlToExport = typeof html === 'string' ? html : '';
        accountCustomPageExportFile(
          { entries: 0, files: 0, uncompressedBytes: 0 },
          Buffer.byteLength(htmlToExport, 'utf-8'),
        );
        await fs.promises.writeFile(path.join(projectDirectory, 'index.html'), htmlToExport, {
          encoding: 'utf-8',
          mode: 0o600,
          flag: 'wx',
        });
      } else {
        const pageRoot = this.getCustomPageFolderRoot(pathname);
        await copyCustomPageTreeWithoutLinks(pageRoot, pageRoot, projectDirectory, {
          entries: 0,
          files: 0,
          uncompressedBytes: 0,
        });
      }

      await createCustomPageZip(projectDirectory, archivePath);
      completed = true;
      return { archivePath, cleanup };
    } finally {
      if (!completed) {
        await cleanup();
      }
    }
  }

  async saveImg(fileName: string, buffer: Buffer, type: StaticType, toRootPath?: boolean) {
    const storageRoot = this.getStorageRoot(type);
    const srcPath = resolvePathWithinRoot(storageRoot, fileName);
    let realPath = `/static/${type}/${fileName}`;

    if (isProd()) {
      if (toRootPath) {
        realPath = `/${fileName}`;
      }
    }
    const result = readSafeImageMetadata(buffer);
    const byteLength = buffer.byteLength;

    fs.writeFileSync(srcPath, buffer);
    const meta: ImgMeta = { ...result, size: formatBytes(byteLength) };
    return {
      meta,
      realPath,
    };
  }

  async deleteCustomPageFolder(name: string) {
    const storageRoot = this.getStorageRoot('customPage');
    const srcPath = resolvePathWithinRoot(storageRoot, normalizeManagedPath(name));
    try {
      await fs.promises.rm(srcPath, { recursive: true, force: false });
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  async deleteFile(fileName: string, type: StaticType) {
    try {
      const storageRoot = this.getStorageRoot(type);
      const srcPath = resolvePathWithinRoot(storageRoot, fileName);
      fs.rmSync(srcPath);
    } catch (err) {
      console.log('删除实际文件失败：', fileName, '可能是更新版本后没映射静态文件目录导致的');
    }
  }
  async exportAllImg() {
    const src = path.join(config.staticPath, 'img');
    const dst = path.join(
      config.staticPath,
      'export',
      `export-img-${dayjs().format('YYYY-MM-DD')}.zip`,
    );
    const dstSrc = `/static/export/export-img-${dayjs().format('YYYY-MM-DD')}.zip`;

    const compressPromise = new Promise((resolve, reject) => {
      compressing.zip
        .compressDir(src, dst)
        .then((v) => {
          resolve(v);
        })
        .catch((e) => {
          reject(e);
        });
    });
    try {
      const r = await Promise.all([compressPromise]);
      console.log(r);
      return {
        success: true,
        path: dstSrc,
      };
    } catch (err) {
      console.log(err);
      return {
        success: false,
        error: err,
      };
    }
  }
}
