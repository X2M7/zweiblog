import { BadRequestException, NotFoundException } from '@nestjs/common';
import { config } from 'src/config';
import { CustomPageController, getCustomPageArchiveName } from './customPage.controller';

describe('CustomPageController single-file operations', () => {
  const originalDemo = config.demo;
  const getCustomPageByPath = jest.fn();
  const renameCustomPageFile = jest.fn();
  const deleteCustomPageFile = jest.fn();
  const deleteCustomPageSubfolder = jest.fn();
  const exportCustomPageProject = jest.fn();
  let controller: CustomPageController;

  beforeEach(() => {
    config.demo = false;
    getCustomPageByPath.mockReset();
    renameCustomPageFile.mockReset();
    deleteCustomPageFile.mockReset();
    deleteCustomPageSubfolder.mockReset();
    exportCustomPageProject.mockReset();
    controller = new CustomPageController(
      { getCustomPageByPath } as any,
      {
        renameCustomPageFile,
        deleteCustomPageFile,
        deleteCustomPageSubfolder,
        exportCustomPageProject,
      } as any,
    );
  });

  afterAll(() => {
    config.demo = originalDemo;
  });

  it('validates the multi-file page before renaming and delegates the exact paths', async () => {
    getCustomPageByPath.mockResolvedValue({ type: 'folder' });
    renameCustomPageFile.mockResolvedValue({ filePath: 'assets/main.js' });

    await expect(
      controller.renameFileInFolder({
        pathname: '/site',
        filePath: 'assets/app.js',
        newBaseName: 'main',
      }),
    ).resolves.toEqual({ statusCode: 200, data: { filePath: 'assets/main.js' } });

    expect(getCustomPageByPath).toHaveBeenCalledWith('/site');
    expect(renameCustomPageFile).toHaveBeenCalledWith('/site', 'assets/app.js', 'main');
  });

  it('validates the multi-file page before deleting and delegates the exact paths', async () => {
    getCustomPageByPath.mockResolvedValue({ type: 'folder' });
    deleteCustomPageFile.mockResolvedValue({ filePath: 'assets/app.js', deleted: true });

    await expect(controller.deleteFileInFolder('/site', 'assets/app.js')).resolves.toEqual({
      statusCode: 200,
      data: { filePath: 'assets/app.js', deleted: true },
    });

    expect(getCustomPageByPath).toHaveBeenCalledWith('/site');
    expect(deleteCustomPageFile).toHaveBeenCalledWith('/site', 'assets/app.js');
  });

  it('rejects a missing page before touching the filesystem', async () => {
    getCustomPageByPath.mockResolvedValue(null);

    await expect(controller.deleteFileInFolder('/missing', 'app.js')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(deleteCustomPageFile).not.toHaveBeenCalled();
  });

  it('rejects a single-file page before touching the filesystem', async () => {
    getCustomPageByPath.mockResolvedValue({ type: 'file' });

    await expect(
      controller.renameFileInFolder({
        pathname: '/single',
        filePath: 'app.js',
        newBaseName: 'main',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(renameCustomPageFile).not.toHaveBeenCalled();
  });

  it('keeps file mutations disabled in demo mode', async () => {
    config.demo = 'true';

    await expect(controller.deleteFileInFolder('/site', 'app.js')).resolves.toMatchObject({
      statusCode: 401,
    });
    expect(getCustomPageByPath).not.toHaveBeenCalled();
    expect(deleteCustomPageFile).not.toHaveBeenCalled();
  });

  it('exports a single-file page as a no-store ZIP attachment and cleans the archive', async () => {
    const cleanup = jest.fn().mockResolvedValue(undefined);
    const response: any = {
      download: jest.fn((_archivePath, _archiveName, callback) => {
        callback(undefined);
        return response;
      }),
      once: jest.fn().mockReturnThis(),
      setHeader: jest.fn().mockReturnThis(),
      type: jest.fn().mockReturnThis(),
    };
    getCustomPageByPath.mockResolvedValue({
      path: '/single',
      type: 'file',
      html: '<main>Single</main>',
      name: '../../unsafe\r\nHeader: value',
    });
    exportCustomPageProject.mockResolvedValue({
      archivePath: 'C:\\safe-temp\\project.zip',
      cleanup,
    });

    await controller.exportProject('/single', response);

    expect(exportCustomPageProject).toHaveBeenCalledWith('/single', 'file', '<main>Single</main>');
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(response.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    expect(response.type).toHaveBeenCalledWith('application/zip');
    const downloadName = response.download.mock.calls[0][1];
    expect(downloadName).toMatch(/\.zip$/);
    expect(downloadName).not.toMatch(/[\\/\r\n:]/);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('rejects exporting a missing page before creating an archive', async () => {
    getCustomPageByPath.mockResolvedValue(null);

    await expect(controller.exportProject('/missing', {} as any)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(exportCustomPageProject).not.toHaveBeenCalled();
  });

  it('validates the multi-file page before recursively deleting a folder', async () => {
    getCustomPageByPath.mockResolvedValue({ type: 'folder' });
    deleteCustomPageSubfolder.mockResolvedValue({ folderPath: 'assets/old', deleted: true });

    await expect(controller.deleteFolderInFolder('/site', 'assets/old')).resolves.toEqual({
      statusCode: 200,
      data: { folderPath: 'assets/old', deleted: true },
    });
    expect(deleteCustomPageSubfolder).toHaveBeenCalledWith('/site', 'assets/old');
  });

  it('rejects recursive folder deletion for a single-file page', async () => {
    getCustomPageByPath.mockResolvedValue({ type: 'file' });

    await expect(controller.deleteFolderInFolder('/single', 'assets')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(deleteCustomPageSubfolder).not.toHaveBeenCalled();
  });

  it('sanitizes reserved and oversized archive names', () => {
    expect(getCustomPageArchiveName('CON', '/page')).toBe('_CON.zip');
    const archiveName = getCustomPageArchiveName('界'.repeat(200), '/page');
    expect(Buffer.byteLength(archiveName, 'utf-8')).toBeLessThanOrEqual(180);
    expect(archiveName).toMatch(/\.zip$/);
  });
});
