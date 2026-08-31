import { PayloadTooLargeException } from '@nestjs/common';
import {
  BACKUP_FILE_MAX_BYTES,
  assertBackupFileSize,
  backupUploadOptions,
  commentImageUploadOptions,
  customPageUploadOptions,
  imageUploadOptions,
} from './uploadLimits';
import { customPageUploadStorage } from './customPageUpload';

describe('backup upload and export limits', () => {
  it('uses one limit for backup upload and export validation', () => {
    expect(backupUploadOptions.limits.fileSize).toBe(BACKUP_FILE_MAX_BYTES);
    expect(() => assertBackupFileSize(1024, 1024)).not.toThrow();
  });

  it('rejects an export that the matching importer cannot accept', () => {
    expect(() => assertBackupFileSize(1025, 1024)).toThrow(PayloadTooLargeException);
  });

  it('keeps anonymous comment images below the authenticated image limit', () => {
    expect(commentImageUploadOptions.limits).toMatchObject({
      files: 1,
      fields: 8,
      parts: 10,
      fileSize: 5 * 1024 * 1024,
    });
    expect(commentImageUploadOptions.limits.fileSize).toBeLessThan(
      imageUploadOptions.limits.fileSize,
    );
  });

  it('streams custom-page uploads to disk without an application-level byte limit', () => {
    expect(customPageUploadOptions.storage).toBe(customPageUploadStorage);
    expect(customPageUploadOptions.storage.constructor.name).toBe('DiskStorage');
    expect(customPageUploadOptions.limits).toMatchObject({
      files: 1,
      fields: 8,
      parts: 10,
    });
    expect(customPageUploadOptions.limits).not.toHaveProperty('fileSize');
  });
});
