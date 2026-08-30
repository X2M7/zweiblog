import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSecretFile, validateMongoUrl } from './secretFile';

describe('secret files', () => {
  const makeDir = () => mkdtempSync(join(tmpdir(), 'zweiblog-secret-test-'));

  it('reads a regular file and removes only trailing newlines', () => {
    const file = join(makeDir(), 'secret');
    writeFileSync(file, '  secret value  \r\n');
    expect(readSecretFile(file)).toBe('  secret value  ');
  });

  it('rejects directories, control bytes and oversized files', () => {
    const dir = makeDir();
    const invalid = join(dir, 'invalid');
    const oversized = join(dir, 'oversized');
    writeFileSync(invalid, 'bad\0secret');
    writeFileSync(oversized, 'x'.repeat(32));
    mkdirSync(join(dir, 'directory'));

    expect(() => readSecretFile(invalid)).toThrow('control characters');
    expect(() => readSecretFile(oversized, 16)).toThrow('invalid size');
    expect(() => readSecretFile(join(dir, 'directory'))).toThrow('regular file');
  });

  (process.platform === 'win32' ? it.skip : it)('rejects symbolic links', () => {
    const dir = makeDir();
    const target = join(dir, 'target');
    const link = join(dir, 'link');
    writeFileSync(target, 'secret');
    symlinkSync(target, link);
    expect(() => readSecretFile(link)).toThrow('regular file');
  });
});

describe('MongoDB URL validation', () => {
  it.each([
    'mongodb://mongo:27017/zweiBlog',
    'mongodb://zweiblog:p%40ss@mongo:27017/zweiBlog?authSource=admin',
    'mongodb+srv://example.invalid/zweiBlog',
  ])('accepts %s', (value) => {
    expect(validateMongoUrl(value)).toBe(value);
  });

  it.each([
    '',
    'https://mongo:27017/zweiBlog',
    'mongodb:///zweiBlog',
    'mongodb://mongo:27017/zwei Blog',
    'not a URL',
  ])('rejects %s', (value) => {
    expect(() => validateMongoUrl(value)).toThrow();
  });
});
