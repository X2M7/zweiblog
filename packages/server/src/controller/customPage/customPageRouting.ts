import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  CUSTOM_PAGE_MAX_PATH_BYTES,
  CUSTOM_PAGE_MAX_PATH_SEGMENTS,
} from 'src/utils/customPagePathLimits';
import { resolvePathWithinRoot } from 'src/utils/safePath';

export { CUSTOM_PAGE_MAX_PATH_BYTES, CUSTOM_PAGE_MAX_PATH_SEGMENTS };

export type CustomPageFileResolution =
  | { kind: 'file'; absolutePath: string; spaFallback: boolean }
  | { kind: 'directory-redirect' }
  | { kind: 'not-found' };

function getPathKind(target: string): 'file' | 'directory' | 'other' | 'missing' {
  try {
    const stat = fs.lstatSync(target);
    if (stat.isFile()) return 'file';
    if (stat.isDirectory()) return 'directory';
    return 'other';
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code || '')) {
      return 'missing';
    }
    throw error;
  }
}

function acceptsExplicitHtml(acceptHeader: unknown) {
  const value = Array.isArray(acceptHeader) ? acceptHeader.join(',') : acceptHeader;
  if (typeof value !== 'string') return false;

  return value.split(',').some((entry) => {
    const [rawMediaType, ...rawParameters] = entry.split(';');
    const mediaType = rawMediaType.trim().toLowerCase();
    if (mediaType !== 'text/html' && mediaType !== 'application/xhtml+xml') return false;

    const quality = rawParameters
      .map((parameter) => parameter.trim().toLowerCase())
      .find((parameter) => parameter.startsWith('q='));
    if (!quality) return true;
    const parsedQuality = Number(quality.slice(2));
    return Number.isFinite(parsedQuality) && parsedQuality > 0;
  });
}

function looksLikeStaticAsset(relativePath: string) {
  const finalSegment = relativePath.split('/').filter(Boolean).at(-1) || '';
  return finalSegment.startsWith('.') || path.posix.extname(finalSegment) !== '';
}

/**
 * Resolve a folder custom-page request without ever falling back an apparent
 * asset request to HTML. SPA fallback is limited to explicit browser HTML
 * navigation, so fetches with `*\/*` and missing JS/CSS/PDF files stay 404.
 */
export function resolveCustomPageFileRequest(options: {
  pageRoot: string;
  remainingSegments: string[];
  requestHasTrailingSlash: boolean;
  acceptHeader: unknown;
}): CustomPageFileResolution {
  const { pageRoot, remainingSegments, requestHasTrailingSlash, acceptHeader } = options;
  const relativePath = remainingSegments.join('/');
  const requestedPath = resolvePathWithinRoot(pageRoot, relativePath);
  const requestedPathKind = getPathKind(requestedPath);

  if (requestedPathKind === 'file') {
    return { kind: 'file', absolutePath: requestedPath, spaFallback: false };
  }

  if (requestedPathKind === 'directory') {
    if (!requestHasTrailingSlash) return { kind: 'directory-redirect' };
    const indexPath = resolvePathWithinRoot(pageRoot, relativePath, 'index.html');
    if (getPathKind(indexPath) === 'file') {
      return { kind: 'file', absolutePath: indexPath, spaFallback: false };
    }
    // An actual directory without its own index is not a virtual SPA route.
    return { kind: 'not-found' };
  }

  if (
    requestedPathKind === 'missing' &&
    remainingSegments.length > 0 &&
    acceptsExplicitHtml(acceptHeader) &&
    !looksLikeStaticAsset(relativePath)
  ) {
    const rootIndexPath = resolvePathWithinRoot(pageRoot, 'index.html');
    if (getPathKind(rootIndexPath) === 'file') {
      return { kind: 'file', absolutePath: rootIndexPath, spaFallback: true };
    }
  }

  return { kind: 'not-found' };
}

/** Preserve the original query string while canonicalising directory URLs. */
export function getDirectoryRedirectLocation(requestPath: string, originalUrl: string) {
  const queryIndex = originalUrl.indexOf('?');
  const query = queryIndex >= 0 ? originalUrl.slice(queryIndex) : '';
  const normalizedRequestPath = `/${requestPath.replace(/^\/+/, '').replace(/\/+$/, '')}`;
  return `${normalizedRequestPath}/${query}`;
}
