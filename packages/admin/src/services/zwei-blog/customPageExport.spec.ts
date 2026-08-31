import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { exportCustomPageMock } = vi.hoisted(() => ({
  exportCustomPageMock: vi.fn(),
}));

vi.mock('./api', () => ({ exportCustomPage: exportCustomPageMock }));

import {
  downloadBlob,
  downloadCustomPageArchive,
  getContentDispositionFileName,
  getCustomPageArchiveFileName,
} from './customPageExport';

describe('custom-page ZIP downloads', () => {
  const click = vi.fn();
  const remove = vi.fn();
  const appendChild = vi.fn();
  const link: any = { href: '', download: '', style: {}, click, remove };
  const createObjectURL = vi.fn(() => 'blob:custom-page');
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.stubGlobal('document', {
      createElement: vi.fn(() => link),
      body: { appendChild },
    });
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('sanitizes fallback names and parses UTF-8 Content-Disposition names', () => {
    expect(getCustomPageArchiveFileName('演示/项目:*')).toBe('项目__.zip');
    expect(getCustomPageArchiveFileName('', '/pages/demo')).toBe('demo.zip');
    expect(getCustomPageArchiveFileName('CON')).toBe('_CON.zip');
    expect(
      new TextEncoder().encode(getCustomPageArchiveFileName('中'.repeat(200))).length,
    ).toBeLessThanOrEqual(255);
    expect(
      getContentDispositionFileName("attachment; filename*=UTF-8''%E6%BC%94%E7%A4%BA.zip"),
    ).toBe('演示.zip');
    expect(getContentDispositionFileName('attachment; filename="demo.zip"')).toBe('demo.zip');
  });

  it('downloads the server ZIP name and always releases the object URL', async () => {
    const blob = new Blob(['zip'], { type: 'application/zip' });
    exportCustomPageMock.mockResolvedValue({
      data: blob,
      response: {
        headers: {
          get: vi.fn(() => "attachment; filename*=UTF-8''%E6%BC%94%E7%A4%BA.zip"),
        },
      },
    });

    await expect(downloadCustomPageArchive('/demo', 'Fallback')).resolves.toBe('演示.zip');
    expect(exportCustomPageMock).toHaveBeenCalledWith('/demo');
    expect(link.download).toBe('演示.zip');
    expect(appendChild).toHaveBeenCalledWith(link);
    expect(click).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:custom-page');
  });

  it('releases the object URL even when the synthetic download click fails', () => {
    click.mockImplementationOnce(() => {
      throw new Error('blocked');
    });

    expect(() => downloadBlob(new Blob(['zip']), 'demo.zip')).toThrow('blocked');
    expect(remove).toHaveBeenCalledTimes(1);
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:custom-page');
  });
});
