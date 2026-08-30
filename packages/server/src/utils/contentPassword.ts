import {
  encryptPassword,
  isScryptPasswordHash,
  timingSafeStringEqual,
  verifyPassword,
} from './crypto';

const CONTENT_PASSWORD_CONTEXT = 'zweiblog-content-access';

export const MAX_CONTENT_PASSWORD_LENGTH = 1024;

export interface ContentPasswordVerificationResult {
  valid: boolean;
  needsRehash: boolean;
}

export function hasContentPassword(password: unknown): password is string {
  return typeof password === 'string' && password.length > 0;
}

export function isValidContentPasswordLength(password: unknown): password is string {
  return (
    typeof password === 'string' &&
    password.length > 0 &&
    password.length <= MAX_CONTENT_PASSWORD_LENGTH
  );
}

export async function hashContentPassword(password: string): Promise<string> {
  if (!isValidContentPasswordLength(password)) {
    throw new TypeError(
      `Content password must contain 1-${MAX_CONTENT_PASSWORD_LENGTH} characters`,
    );
  }
  return encryptPassword(CONTENT_PASSWORD_CONTEXT, password, '');
}

/**
 * Content access passwords used to be stored as plaintext. Scrypt hashes are
 * verified with the shared password primitive; other values are compared in
 * constant time and marked for a one-time transparent migration.
 */
export async function verifyContentPassword(
  password: string,
  storedPassword: string,
): Promise<ContentPasswordVerificationResult> {
  if (!isValidContentPasswordLength(password) || !hasContentPassword(storedPassword)) {
    return { valid: false, needsRehash: false };
  }

  if (isScryptPasswordHash(storedPassword)) {
    const result = await verifyPassword(CONTENT_PASSWORD_CONTEXT, password, '', storedPassword);
    return { valid: result.valid, needsRehash: false };
  }

  const valid = timingSafeStringEqual(password, storedPassword);
  return { valid, needsRehash: valid };
}
