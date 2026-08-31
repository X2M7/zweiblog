import type { ImgCropProps } from 'antd-img-crop';

export interface UploadApiResponse<T = unknown> {
  statusCode?: number;
  data?: T;
  message?: unknown;
}

export const fitEntireImageCropProps = {
  quality: 1,
  fillColor: 'rgba(255,255,255,0)',
  minZoom: 0.01,
  maxZoom: 3,
  showReset: true,
  resetText: '重置',
  modalTitle: '调整图片',
  modalOk: '使用此图片',
  modalCancel: '取消',
  cropperProps: {
    objectFit: 'contain' as const,
    restrictPosition: false,
  } as NonNullable<ImgCropProps['cropperProps']>,
};

export class UploadRequestError extends Error {
  constructor(
    readonly status: number | undefined,
    readonly response: UploadApiResponse | undefined,
  ) {
    super('Upload request failed');
    this.name = 'UploadRequestError';
  }
}

export function buildUploadUrl(url: string, fileName: string) {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}name=${encodeURIComponent(fileName)}`;
}

export function isSuccessfulUpload(response: UploadApiResponse | undefined, httpOk = true) {
  return httpOk && response?.statusCode === 200;
}

function responseMessage(response: UploadApiResponse | undefined) {
  const value = response?.message;
  const text = Array.isArray(value) ? value.join('；') : typeof value === 'string' ? value : '';
  return text
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 240);
}

export function getUploadErrorMessage(
  fileName: string,
  status?: number,
  response?: UploadApiResponse,
) {
  const prefix = fileName ? `${fileName} 上传失败` : '上传失败';
  const responseStatus = Number(response?.statusCode);

  if (status === 413 || responseStatus === 413) {
    return `${prefix}：文件超过上传限制。图片最多 10 MiB；若文件更小，请检查外层 Nginx 的 client_max_body_size。`;
  }
  if (status === 401 || responseStatus === 401) {
    return `${prefix}：登录状态已失效，请重新登录。`;
  }

  const detail = responseMessage(response);
  if (detail) return `${prefix}：${detail}`;
  if (status && status >= 400) return `${prefix}（HTTP ${status}）`;
  return `${prefix}，请检查网络、图片格式和服务器日志。`;
}

export async function requireSuccessfulUpload(response: Response) {
  let payload: UploadApiResponse | undefined;
  try {
    payload = (await response.json()) as UploadApiResponse;
  } catch {
    payload = undefined;
  }

  if (!isSuccessfulUpload(payload, response.ok)) {
    throw new UploadRequestError(response.status, payload);
  }
  return payload;
}

export function getUploadErrorFromUnknown(error: unknown, fileName: string) {
  if (error instanceof UploadRequestError) {
    return getUploadErrorMessage(fileName, error.status, error.response);
  }
  return getUploadErrorMessage(fileName);
}
