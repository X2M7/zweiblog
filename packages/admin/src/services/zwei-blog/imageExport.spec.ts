import { beforeEach, describe, expect, it, vi } from 'vitest';

const { exportAllImgs, downloadBlob } = vi.hoisted(() => ({
  exportAllImgs: vi.fn(),
  downloadBlob: vi.fn(),
}));
vi.mock('./api', () => ({ exportAllImgs }));
vi.mock('./customPageExport', () => ({ downloadBlob }));
import { downloadImageArchive } from './imageExport';

describe('private image archive downloads', () => {
  beforeEach(() => vi.clearAllMocks());
  it('downloads the authenticated response without exposing a public URL', async () => {
    const blob = new Blob(['archive'], { type: 'application/zip' });
    exportAllImgs.mockResolvedValue({ data: blob, response: { status: 200 } });
    await downloadImageArchive();
    expect(downloadBlob).toHaveBeenCalledWith(blob, 'zweiblog-images.zip');
  });
  it.each([
    { data: '/static/export/legacy.zip' },
    { data: new Blob(['{"message":"denied"}'], { type: 'application/json' }) },
    { data: new Blob(['error']), response: { status: 500 } },
  ])('rejects unsuccessful responses without downloading an error as a ZIP', async (result) => {
    exportAllImgs.mockResolvedValue(result);
    await expect(downloadImageArchive()).rejects.toThrow('图片导出失败');
    expect(downloadBlob).not.toHaveBeenCalled();
  });
});
