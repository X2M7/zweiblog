import { exportAllImgs } from './api';
import { downloadBlob } from './customPageExport';

export async function downloadImageArchive(): Promise<void> {
  const result: any = await exportAllImgs();
  const blob = result?.data instanceof Blob ? result.data : result;
  if (
    !(blob instanceof Blob) ||
    blob.type.includes('json') ||
    (result?.response?.status && result.response.status >= 400)
  ) {
    throw new Error('图片导出失败，请稍后重试。');
  }
  downloadBlob(blob, 'zweiblog-images.zip');
}
