/**
 * crypto 常用封装方法
 */

import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { sha256 } from 'js-sha256';

const SCRYPT_VERSION = 'v1';
const SCRYPT_COST = 32768;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;
const SCRYPT_PREFIX = `scrypt$${SCRYPT_VERSION}$`;

export interface PasswordVerificationResult {
  valid: boolean;
  needsRehash: boolean;
}

// 随机盐
export function makeSalt(): string {
  return randomBytes(32).toString('base64');
}

function deriveScrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      SCRYPT_KEY_LENGTH,
      {
        N: SCRYPT_COST,
        r: SCRYPT_BLOCK_SIZE,
        p: SCRYPT_PARALLELIZATION,
        maxmem: SCRYPT_MAX_MEMORY,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derivedKey as Buffer);
      },
    );
  });
}

/**
 * 使用固定长度摘要比较字符串，避免直接比较恢复密钥或密码摘要。
 */
export function timingSafeStringEqual(left: string, right: string): boolean {
  if (typeof left !== 'string' || typeof right !== 'string') {
    return false;
  }
  const leftDigest = createHash('sha256').update(left, 'utf8').digest();
  const rightDigest = createHash('sha256').update(right, 'utf8').digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

/**
 * 旧版本 SHA-256 密码摘要。仅用于兼容校验，禁止用于新密码。
 */
export function encryptLegacyPassword(username: string, password: string, salt: string): string {
  if (!username || !password || !salt) {
    return '';
  }
  return sha256(sha256(username + sha256(password + salt)) + salt + sha256(username + salt));
}

/**
 * 使用 Node.js 内置 scrypt 生成带版本和参数的密码摘要。
 * username 与外部 salt 参数仅为兼容旧调用签名保留；新摘要自带随机盐。
 */
export async function encryptPassword(
  _username: string,
  password: string,
  _salt: string,
): Promise<string> {
  void _username;
  void _salt;
  if (typeof password !== 'string' || password.length === 0) {
    throw new TypeError('Password must not be empty');
  }
  const salt = randomBytes(16);
  const digest = await deriveScrypt(password, salt);
  return [
    'scrypt',
    SCRYPT_VERSION,
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELIZATION,
    salt.toString('base64'),
    digest.toString('base64'),
  ].join('$');
}

export function isScryptPasswordHash(passwordHash: string): boolean {
  return typeof passwordHash === 'string' && passwordHash.startsWith(SCRYPT_PREFIX);
}

/**
 * 校验当前 scrypt 摘要，也兼容旧 SHA-256 摘要。
 */
export async function verifyPassword(
  username: string,
  password: string,
  legacySalt: string,
  storedHash: string,
): Promise<PasswordVerificationResult> {
  if (!username || !password || !storedHash) {
    return { valid: false, needsRehash: false };
  }

  if (!isScryptPasswordHash(storedHash)) {
    const expectedHash = encryptLegacyPassword(username, password, legacySalt);
    return {
      valid: timingSafeStringEqual(expectedHash, storedHash),
      needsRehash: true,
    };
  }

  const parts = storedHash.split('$');
  if (parts.length !== 7) {
    return { valid: false, needsRehash: false };
  }
  const [algorithm, version, cost, blockSize, parallelization, saltBase64, hashBase64] = parts;
  if (
    algorithm !== 'scrypt' ||
    version !== SCRYPT_VERSION ||
    Number(cost) !== SCRYPT_COST ||
    Number(blockSize) !== SCRYPT_BLOCK_SIZE ||
    Number(parallelization) !== SCRYPT_PARALLELIZATION
  ) {
    return { valid: false, needsRehash: false };
  }

  const salt = Buffer.from(saltBase64, 'base64');
  const storedDigest = Buffer.from(hashBase64, 'base64');
  if (
    salt.length !== 16 ||
    storedDigest.length !== SCRYPT_KEY_LENGTH ||
    salt.toString('base64') !== saltBase64 ||
    storedDigest.toString('base64') !== hashBase64
  ) {
    return { valid: false, needsRehash: false };
  }

  const actualDigest = await deriveScrypt(password, salt);
  return {
    valid: timingSafeEqual(actualDigest, storedDigest),
    needsRehash: false,
  };
}

/**
 * 把没有加过盐的旧版本密码清洗为新版 scrypt 摘要。
 */
export async function washPassword(username: string, password: string, salt: string) {
  username = username.toLowerCase();
  const browserPassword = sha256(
    username + sha256(sha256(sha256(sha256(password))) + sha256(username)),
  );
  return await encryptPassword(username, browserPassword, salt);
}

// 计算文件 MD5
export function encryptFileMD5(buffer: Buffer) {
  const md5 = createHash('md5');

  return md5.update(buffer).digest('hex');
}
