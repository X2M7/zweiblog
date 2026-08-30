import { BadRequestException } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';

const INVALID_WINDOWS_SEGMENT = /[<>:"|?*]/;

function getCanonicalRoot(root: string) {
  const resolvedRoot = path.resolve(root);
  return fs.existsSync(resolvedRoot) ? fs.realpathSync(resolvedRoot) : resolvedRoot;
}

function splitRelativePath(value: string) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new BadRequestException('Invalid path');
  }

  const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = normalized.split('/').filter((segment) => segment && segment !== '.');

  if (
    segments.some(
      (segment) =>
        segment === '..' ||
        (process.platform === 'win32' && INVALID_WINDOWS_SEGMENT.test(segment)),
    )
  ) {
    throw new BadRequestException('Invalid path');
  }

  return segments;
}

function assertContained(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new BadRequestException('Invalid path');
  }
}

function assertNoSymlinkComponents(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  let current = root;

  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      throw new BadRequestException('Symbolic links are not allowed in managed paths');
    }
  }
}

/**
 * Resolve user-controlled relative path components below a trusted root.
 * Leading slashes are accepted for compatibility with ZweiBlog page paths,
 * while traversal, absolute-path escapes and symlink escapes are rejected.
 */
export function resolvePathWithinRoot(root: string, ...parts: string[]) {
  const canonicalRoot = getCanonicalRoot(root);
  const segments = parts.flatMap(splitRelativePath);
  const candidate = path.resolve(canonicalRoot, ...segments);

  assertContained(canonicalRoot, candidate);
  assertNoSymlinkComponents(canonicalRoot, candidate);
  return candidate;
}

export function relativePathFromRoot(root: string, target: string) {
  const canonicalRoot = getCanonicalRoot(root);
  const candidate = path.resolve(target);
  assertContained(canonicalRoot, candidate);
  return path.relative(canonicalRoot, candidate).split(path.sep).join('/');
}

export function normalizeManagedPath(value: string) {
  const segments = splitRelativePath(value);
  if (!segments.length) {
    throw new BadRequestException('Invalid path');
  }
  return `/${segments.join('/')}`;
}
