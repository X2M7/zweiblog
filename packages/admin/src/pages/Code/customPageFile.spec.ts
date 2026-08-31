import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  countCustomPageDirectoryContents,
  getCustomPageDirectoryKeys,
  getCustomPageFileParent,
  getRenamedCustomPageFileKey,
  isCustomPageKeyWithinDirectory,
  normalizeCustomPageFileKey,
  removeCustomPageTreeNode,
  splitCustomPageFileName,
  validateCustomPageFileBaseName,
} from './customPageFile';

const { requestMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
}));

vi.mock('umi', () => ({ request: requestMock }));

import {
  createCustomFile,
  createCustomFolder,
  deleteCustomPageByPath,
  deleteCustomPageFolder,
  deleteCustomPageFile,
  exportCustomPage,
  getCustomPageByPath,
  getCustomPageFileDataByPath,
  getCustomPageFolderTreeByPath,
  renameCustomPageFile,
} from '../../services/zwei-blog/api';

describe('custom-page file helpers', () => {
  it.each([
    ['index.html', { baseName: 'index', extension: '.html' }],
    ['app.min.js', { baseName: 'app.min', extension: '.js' }],
    ['README', { baseName: 'README', extension: '' }],
    ['.env', { baseName: '.env', extension: '' }],
    ['.env.local', { baseName: '.env', extension: '.local' }],
    ['..hidden', { baseName: '.', extension: '.hidden' }],
    ['index.', { baseName: 'index', extension: '.' }],
    ['..', { baseName: '..', extension: '' }],
  ])('splits %s while preserving only its last extension', (name, expected) => {
    expect(splitCustomPageFileName(name)).toEqual(expected);
  });

  it('normalizes Windows tree keys and derives parents and renamed keys', () => {
    expect(normalizeCustomPageFileKey('.\\assets\\scripts//app.js/')).toBe('assets/scripts/app.js');
    expect(getCustomPageFileParent('assets\\scripts\\app.js')).toBe('assets/scripts');
    expect(getCustomPageFileParent('index.html')).toBe('');
    expect(getRenamedCustomPageFileKey('assets\\scripts\\app.js', 'main.js')).toBe(
      'assets/scripts/main.js',
    );
    expect(getRenamedCustomPageFileKey('index.html', 'home.html')).toBe('home.html');
  });

  it('collects normalized nested directory keys for an asynchronously loaded tree', () => {
    expect(
      getCustomPageDirectoryKeys([
        {
          key: 'assets',
          type: 'directory',
          children: [
            {
              key: 'assets\\scripts',
              type: 'directory',
              children: [{ key: 'assets\\scripts\\app.js', type: 'file' }],
            },
          ],
        },
        { key: 'index.html', type: 'file' },
      ]),
    ).toEqual(['assets', 'assets/scripts']);
  });

  it('matches directory membership only on complete path segments', () => {
    expect(isCustomPageKeyWithinDirectory('assets', 'assets')).toBe(true);
    expect(isCustomPageKeyWithinDirectory('assets/scripts/app.js', 'assets')).toBe(true);
    expect(isCustomPageKeyWithinDirectory('assets2/app.js', 'assets')).toBe(false);
    expect(isCustomPageKeyWithinDirectory('assets/app.js', '')).toBe(false);
  });

  it('counts and immutably removes an entire directory subtree', () => {
    const tree = [
      {
        key: 'assets',
        type: 'directory',
        children: [
          { key: 'assets/app.js', type: 'file' },
          {
            key: 'assets/images',
            type: 'directory',
            children: [{ key: 'assets/images/logo.svg', type: 'file' }],
          },
        ],
      },
      { key: 'index.html', type: 'file' },
    ];

    expect(countCustomPageDirectoryContents(tree[0])).toEqual({ files: 2, directories: 1 });
    expect(removeCustomPageTreeNode(tree, 'assets')).toEqual([{ key: 'index.html', type: 'file' }]);
    expect(tree).toHaveLength(2);
  });

  it('accepts ordinary, dotted and Chinese base names', () => {
    expect(validateCustomPageFileBaseName('index', '.html')).toBeUndefined();
    expect(validateCustomPageFileBaseName('.env', '')).toBeUndefined();
    expect(validateCustomPageFileBaseName('app.min', '.js')).toBeUndefined();
    expect(validateCustomPageFileBaseName('首页', '.html')).toBeUndefined();
  });

  it.each([
    ['', '.html', '文件名不能为空'],
    ['   ', '.html', '文件名不能为空'],
    [' index', '.html', '文件名不能以空白字符开头或结尾'],
    ['index ', '.html', '文件名不能以空白字符开头或结尾'],
    ['.', '', '文件名不能是“.”或“..”'],
    ['..', '', '文件名不能是“.”或“..”'],
    ['bad/name', '.html', '文件名不能包含控制字符'],
    ['bad\nname', '.html', '文件名不能包含控制字符'],
    ['trailing.', '.html', '文件名不能以句点结尾'],
    ['CON', '.txt', '文件名不能使用 Windows 保留名称'],
    ['com9.data', '.txt', '文件名不能使用 Windows 保留名称'],
  ])('rejects invalid base name %j', (baseName, extension, expectedMessage) => {
    expect(validateCustomPageFileBaseName(baseName, extension)).toContain(expectedMessage);
  });

  it('enforces the 255-byte limit on the final file name', () => {
    expect(validateCustomPageFileBaseName('中'.repeat(83), '.html')).toBeUndefined();
    expect(validateCustomPageFileBaseName('中'.repeat(84), '.html')).toContain('255');
  });
});

describe('custom-page file API contract', () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockResolvedValue({ data: {} });
  });

  it('renames and deletes a file through the unified file resource', async () => {
    await renameCustomPageFile('/demo?a=1', 'assets/app & old.js', 'main');
    expect(requestMock).toHaveBeenLastCalledWith('/api/admin/customPage/file', {
      method: 'PATCH',
      data: {
        pathname: '/demo?a=1',
        filePath: 'assets/app & old.js',
        newBaseName: 'main',
      },
    });

    await deleteCustomPageFile('/demo?a=1', 'assets/app & old.js');
    expect(requestMock).toHaveBeenLastCalledWith('/api/admin/customPage/file', {
      method: 'DELETE',
      params: { pathname: '/demo?a=1', filePath: 'assets/app & old.js' },
    });
  });

  it('recursively deletes folders and exports either custom-page type as a ZIP blob', async () => {
    await deleteCustomPageFolder('/demo?a=1', 'assets/nested & special');
    expect(requestMock).toHaveBeenLastCalledWith('/api/admin/customPage/folder', {
      method: 'DELETE',
      params: { pathname: '/demo?a=1', folderPath: 'assets/nested & special' },
    });

    await exportCustomPage('/demo?a=1');
    expect(requestMock).toHaveBeenLastCalledWith('/api/admin/customPage/export', {
      method: 'GET',
      params: { path: '/demo?a=1' },
      responseType: 'blob',
      getResponse: true,
      skipErrorHandler: true,
    });
  });

  it('uses the folder endpoint for folder creation and params for existing queries', async () => {
    await createCustomFile('/demo?a=1', 'assets/a & b.js');
    expect(requestMock).toHaveBeenLastCalledWith('/api/admin/customPage/file', {
      method: 'POST',
      params: { path: '/demo?a=1', subPath: 'assets/a & b.js' },
    });

    await createCustomFolder('/demo?a=1', 'assets/a & b');
    expect(requestMock).toHaveBeenLastCalledWith('/api/admin/customPage/folder', {
      method: 'POST',
      params: { path: '/demo?a=1', subPath: 'assets/a & b' },
    });

    await deleteCustomPageByPath('/demo?a=1');
    expect(requestMock).toHaveBeenLastCalledWith('/api/admin/customPage', {
      method: 'DELETE',
      params: { path: '/demo?a=1' },
    });

    await getCustomPageByPath('/demo?a=1');
    expect(requestMock).toHaveBeenLastCalledWith('/api/admin/customPage', {
      method: 'GET',
      params: { path: '/demo?a=1' },
    });

    await getCustomPageFolderTreeByPath('/demo?a=1');
    expect(requestMock).toHaveBeenLastCalledWith('/api/admin/customPage/folder', {
      method: 'GET',
      params: { path: '/demo?a=1' },
    });

    await getCustomPageFileDataByPath('/demo?a=1', 'assets/a & b.js');
    expect(requestMock).toHaveBeenLastCalledWith('/api/admin/customPage/file', {
      method: 'GET',
      params: { path: '/demo?a=1', key: 'assets/a & b.js' },
    });
  });
});
