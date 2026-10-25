import { ForbiddenException } from '@nestjs/common';
import { Request } from 'express';

export function assertSameOriginCommentRequest(request: Request) {
  if (String(request.headers['sec-fetch-site'] || '').toLocaleLowerCase() === 'cross-site') {
    throw new ForbiddenException('Cross-site comment changes are not allowed');
  }
  let host = request.get('host');
  const remoteAddress = request.socket?.remoteAddress;
  const trustProxy = request.app?.get?.('trust proxy fn');
  // Next's local rewrite changes the upstream Host and preserves the browser
  // host in X-Forwarded-Host. Honor it only when Express' configured trust
  // function confirms the immediate peer (Caddy/Next) is trusted.
  if (remoteAddress && typeof trustProxy === 'function' && trustProxy(remoteAddress, 0)) {
    const forwardedHost = String(request.headers['x-forwarded-host'] || '')
      .split(',')[0]
      .trim();
    if (forwardedHost) host = forwardedHost;
  }
  if (!host) throw new ForbiddenException('A valid request host is required');
  let expectedOrigin: string;
  try {
    if (/[\u0000-\u0020\\/?#@]/u.test(host)) throw new Error('invalid host');
    expectedOrigin = new URL(`${request.protocol}://${host}`).origin;
  } catch {
    throw new ForbiddenException('A valid request host is required');
  }
  for (const header of ['origin', 'referer'] as const) {
    const value = request.headers[header];
    if (!value) continue;
    try {
      if (new URL(String(value)).origin !== expectedOrigin) {
        throw new ForbiddenException('Cross-site comment changes are not allowed');
      }
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      throw new ForbiddenException('Invalid request origin');
    }
  }
}
