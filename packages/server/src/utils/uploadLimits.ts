import { PayloadTooLargeException } from '@nestjs/common';
import { customPageUploadStorage } from './customPageUpload';

const commonMultipartLimits = {
  files: 1,
  fields: 8,
  parts: 10,
  fieldNameSize: 100,
  fieldSize: 64 * 1024,
  headerPairs: 100,
};

const MEBIBYTE = 1024 * 1024;
const DEFAULT_BACKUP_FILE_MAX_BYTES = 256 * MEBIBYTE;
const ABSOLUTE_BACKUP_FILE_MAX_BYTES = 512 * MEBIBYTE;

function backupFileMaxBytes() {
  const configured = Number(process.env.ZWEI_BLOG_BACKUP_MAX_BYTES || '');
  if (!Number.isSafeInteger(configured) || configured < MEBIBYTE) {
    return DEFAULT_BACKUP_FILE_MAX_BYTES;
  }
  return Math.min(configured, ABSOLUTE_BACKUP_FILE_MAX_BYTES);
}

export const BACKUP_FILE_MAX_BYTES = backupFileMaxBytes();

export function assertBackupFileSize(size: number, maximum = BACKUP_FILE_MAX_BYTES): void {
  if (!Number.isSafeInteger(size) || size < 0 || size > maximum) {
    throw new PayloadTooLargeException(
      `Backup is ${size} bytes and exceeds ZWEI_BLOG_BACKUP_MAX_BYTES (${maximum}); use a MongoDB snapshot or raise the limit on both source and target`,
    );
  }
}

export const imageUploadOptions = {
  limits: {
    ...commonMultipartLimits,
    fileSize: 10 * 1024 * 1024,
  },
};

/** Public comment uploads are deliberately smaller than authenticated uploads. */
export const commentImageUploadOptions = {
  limits: {
    ...commonMultipartLimits,
    fileSize: 5 * 1024 * 1024,
  },
};

export const customPageUploadOptions = {
  storage: customPageUploadStorage,
  limits: {
    ...commonMultipartLimits,
  },
};

export const backupUploadOptions = {
  limits: {
    ...commonMultipartLimits,
    fileSize: BACKUP_FILE_MAX_BYTES,
  },
};
