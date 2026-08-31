import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readDir, readDirs } from './readFileList';

describe('custom-page file tree paths', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'zweiblog-file-tree-'));
    mkdirSync(join(root, 'assets', 'scripts'), { recursive: true });
    writeFileSync(join(root, 'assets', 'scripts', 'app.js'), 'content');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('uses forward slashes for recursive tree keys and parents on every platform', () => {
    const tree = readDirs(root, root);
    const assets = tree.find((item) => item.title === 'assets');
    const scripts = assets.children.find((item) => item.title === 'scripts');
    const file = scripts.children.find((item) => item.title === 'app.js');

    expect(assets).toMatchObject({ key: 'assets', parent: '' });
    expect(scripts).toMatchObject({ key: 'assets/scripts', parent: 'assets' });
    expect(file).toMatchObject({
      key: 'assets/scripts/app.js',
      parent: 'assets/scripts',
    });
  });

  it('uses forward slashes for shallow directory listings', () => {
    const listing = readDir(join(root, 'assets', 'scripts'), root);

    expect(listing).toContainEqual(
      expect.objectContaining({ key: 'assets/scripts/app.js', parent: 'assets/scripts' }),
    );
  });
});
