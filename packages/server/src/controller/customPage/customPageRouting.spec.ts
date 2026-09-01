import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDirectoryRedirectLocation, resolveCustomPageFileRequest } from './customPageRouting';

describe('custom-page project file routing', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'zweiblog-custom-page-routing-'));
    mkdirSync(join(root, 'docs'));
    mkdirSync(join(root, 'empty'));
    mkdirSync(join(root, 'assets'));
    writeFileSync(join(root, 'index.html'), '<main>SPA root</main>');
    writeFileSync(join(root, 'docs', 'index.html'), '<main>Docs</main>');
    writeFileSync(join(root, 'assets', 'app.js'), 'window.ready = true;');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('serves exact project files and nested directory indexes', () => {
    expect(
      resolveCustomPageFileRequest({
        pageRoot: root,
        remainingSegments: ['assets', 'app.js'],
        requestHasTrailingSlash: false,
        acceptHeader: '*/*',
      }),
    ).toEqual({
      kind: 'file',
      absolutePath: join(root, 'assets', 'app.js'),
      spaFallback: false,
    });

    expect(
      resolveCustomPageFileRequest({
        pageRoot: root,
        remainingSegments: ['docs'],
        requestHasTrailingSlash: false,
        acceptHeader: 'text/html',
      }),
    ).toEqual({ kind: 'directory-redirect' });

    expect(
      resolveCustomPageFileRequest({
        pageRoot: root,
        remainingSegments: ['docs'],
        requestHasTrailingSlash: true,
        acceptHeader: 'text/html',
      }),
    ).toEqual({
      kind: 'file',
      absolutePath: join(root, 'docs', 'index.html'),
      spaFallback: false,
    });
  });

  it('uses the project index only for explicit extensionless HTML navigation', () => {
    expect(
      resolveCustomPageFileRequest({
        pageRoot: root,
        remainingSegments: ['dashboard', 'settings'],
        requestHasTrailingSlash: false,
        acceptHeader: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      }),
    ).toEqual({
      kind: 'file',
      absolutePath: join(root, 'index.html'),
      spaFallback: true,
    });

    for (const acceptHeader of [undefined, '*/*', 'application/json', 'text/html;q=0']) {
      expect(
        resolveCustomPageFileRequest({
          pageRoot: root,
          remainingSegments: ['dashboard', 'settings'],
          requestHasTrailingSlash: false,
          acceptHeader,
        }),
      ).toEqual({ kind: 'not-found' });
    }
  });

  it.each(['missing.js', 'missing.css', 'manual.pdf', 'data.json', 'app.js.map', '.env'])(
    'does not disguise a missing %s asset as HTML',
    (fileName) => {
      expect(
        resolveCustomPageFileRequest({
          pageRoot: root,
          remainingSegments: ['assets', fileName],
          requestHasTrailingSlash: false,
          acceptHeader: 'text/html',
        }),
      ).toEqual({ kind: 'not-found' });
    },
  );

  it('does not replace a real directory missing its own index with the SPA root', () => {
    expect(
      resolveCustomPageFileRequest({
        pageRoot: root,
        remainingSegments: ['empty'],
        requestHasTrailingSlash: true,
        acceptHeader: 'text/html',
      }),
    ).toEqual({ kind: 'not-found' });
  });

  it('preserves a query string when redirecting a directory URL', () => {
    expect(getDirectoryRedirectLocation('/c/site/docs', '/c/site/docs?lang=en&mode=preview')).toBe(
      '/c/site/docs/?lang=en&mode=preview',
    );
  });
});
