import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { diskStorage } from 'multer';
import { config } from 'src/config';

const CUSTOM_PAGE_UPLOAD_TEMP_DIRECTORY = '.zweiblog-custom-page-uploads';

export function getCustomPageUploadTempRoot() {
  return path.join(config.staticPath, CUSTOM_PAGE_UPLOAD_TEMP_DIRECTORY);
}

function resolveTemporaryUpload(filePath: string) {
  if (typeof filePath !== 'string' || !filePath) {
    throw new BadRequestException('A temporary upload file is required');
  }
  const root = path.resolve(getCustomPageUploadTempRoot());
  const candidate = path.resolve(filePath);
  const relative = path.relative(root, candidate);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new BadRequestException('Invalid temporary upload path');
  }
  return candidate;
}

export function assertCustomPageTemporaryUpload(filePath: string) {
  const candidate = resolveTemporaryUpload(filePath);
  const pathStat = fs.lstatSync(candidate);
  if (pathStat.isSymbolicLink() || !pathStat.isFile()) {
    throw new BadRequestException('Invalid temporary upload file');
  }

  const realRoot = fs.realpathSync(getCustomPageUploadTempRoot());
  const realCandidate = fs.realpathSync(candidate);
  const relative = path.relative(realRoot, realCandidate);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new BadRequestException('Invalid temporary upload file');
  }
  return { path: candidate, size: pathStat.size };
}

export async function removeCustomPageTemporaryUpload(filePath: unknown) {
  if (typeof filePath !== 'string' || !filePath) return;
  let candidate: string;
  try {
    candidate = resolveTemporaryUpload(filePath);
  } catch {
    return;
  }
  await fs.promises.rm(candidate, { force: true }).catch(() => undefined);
}

/**
 * Custom-page files can be arbitrarily large, so they must never use
 * Multer's in-memory storage. The random staging name is not exposed through
 * `/static`; the controller moves it into a validated project path.
 */
export const customPageUploadStorage = diskStorage({
  destination: (_request, _file, callback) => {
    try {
      const directory = getCustomPageUploadTempRoot();
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      callback(null, directory);
    } catch (error) {
      callback(error as Error, '');
    }
  },
  filename: (_request, _file, callback) => callback(null, randomUUID()),
});
