import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

const DEFAULT_MAX_SECRET_BYTES = 8192;

/** Read a small, regular secret file without trimming meaningful whitespace. */
export const readSecretFile = (file: string, maxBytes = DEFAULT_MAX_SECRET_BYTES): string => {
  if (!file || !isAbsolute(file)) {
    throw new Error('Secret file path must be absolute');
  }

  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('Secret path must reference a regular file');
  }
  if (stat.size <= 0 || stat.size > maxBytes) {
    throw new Error('Secret file has an invalid size');
  }

  // Docker secret files commonly end with one newline. Only remove line
  // terminators at EOF so spaces inside passwords and URIs remain intact.
  const value = readFileSync(file, 'utf8').replace(/[\r\n]+$/, '');
  if (!value || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('Secret file contains invalid control characters');
  }
  return value;
};

export const validateMongoUrl = (value: string): string => {
  if (!value || value.length > DEFAULT_MAX_SECRET_BYTES) {
    throw new Error('MongoDB connection URL has an invalid size');
  }
  if (/[\u0000-\u0020\u007f]/.test(value)) {
    throw new Error('MongoDB connection URL contains invalid whitespace');
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('MongoDB connection URL is invalid');
  }
  if (!['mongodb:', 'mongodb+srv:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error('MongoDB connection URL must use mongodb:// or mongodb+srv://');
  }
  return value;
};
