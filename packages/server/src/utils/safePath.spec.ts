import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { relativePathFromRoot, resolvePathWithinRoot } from './safePath';

describe('resolvePathWithinRoot', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'zweiblog-safe-path-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('resolves ordinary and leading-slash paths below the root', () => {
    const result = resolvePathWithinRoot(root, '/page', 'assets/app.js');
    expect(relativePathFromRoot(root, result)).toBe('page/assets/app.js');
  });

  it.each(['../secret', '/page/../../secret', '..\\secret'])('rejects traversal: %s', (input) => {
    expect(() => resolvePathWithinRoot(root, input)).toThrow('Invalid path');
  });

  it.each(['file\0.txt', 'file\nname.txt', 'file\u007fname.txt'])(
    'rejects control characters: %s',
    (input) => {
      expect(() => resolvePathWithinRoot(root, input)).toThrow('Invalid path');
    },
  );

  it('makes the root distinguishable so destructive callers can reject it', () => {
    const resolvedRoot = resolvePathWithinRoot(root, '/');
    expect(relativePathFromRoot(root, resolvedRoot)).toBe('');
  });

  it('rejects existing symbolic-link components', () => {
    const outside = mkdtempSync(join(tmpdir(), 'zweiblog-safe-path-outside-'));
    mkdirSync(join(root, 'page'));

    try {
      symlinkSync(outside, join(root, 'page', 'link'), 'junction');
      expect(() => resolvePathWithinRoot(root, 'page/link/file.txt')).toThrow(
        'Symbolic links are not allowed',
      );
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
