import { exportCustomPage } from './api';

const WINDOWS_RESERVED_FILE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const ZIP_EXTENSION_BYTES = new TextEncoder().encode('.zip').length;

function truncateUtf8(value: string, maximumBytes: number): string {
  let result = '';
  let byteLength = 0;
  for (const character of value) {
    const characterBytes = new TextEncoder().encode(character).length;
    if (byteLength + characterBytes > maximumBytes) break;
    result += character;
    byteLength += characterBytes;
  }
  return result;
}

function safeArchiveBaseName(value: string): string {
  const lastSegment = String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .pop();
  let baseName =
    String(lastSegment || 'custom-page')
      .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_')
      .replace(/[.\s]+$/g, '')
      .trim() || 'custom-page';
  if (WINDOWS_RESERVED_FILE_NAME.test(baseName)) baseName = `_${baseName}`;
  baseName = truncateUtf8(baseName, 255 - ZIP_EXTENSION_BYTES).replace(/[.\s]+$/g, '');
  return baseName || 'custom-page';
}

export function getCustomPageArchiveFileName(name?: string, path?: string): string {
  const baseName = safeArchiveBaseName(name || path || 'custom-page').replace(/\.zip$/i, '');
  return `${baseName || 'custom-page'}.zip`;
}

export function getContentDispositionFileName(value?: string | null): string | undefined {
  if (!value) return undefined;
  const encoded = value.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded.trim().replace(/^"|"$/g, ''));
    } catch {
      // Fall back to the ordinary filename parameter below.
    }
  }
  return (
    value.match(/filename\s*=\s*"([^"]+)"/i)?.[1] ||
    value.match(/filename\s*=\s*([^;]+)/i)?.[1]?.trim()
  );
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = getCustomPageArchiveFileName(fileName);
  link.style.display = 'none';

  try {
    document.body?.appendChild(link);
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

export async function downloadCustomPageArchive(path: string, name?: string): Promise<string> {
  const result: any = await exportCustomPage(path);
  const blob = result?.data instanceof Blob ? result.data : result;
  if (!(blob instanceof Blob)) {
    throw new Error('导出接口未返回有效的 ZIP 文件。');
  }

  const disposition = result?.response?.headers?.get?.('content-disposition');
  const serverFileName = getContentDispositionFileName(disposition);
  const fileName = getCustomPageArchiveFileName(serverFileName || name, path);
  downloadBlob(blob, fileName);
  return fileName;
}
