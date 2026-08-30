import { Injectable } from '@nestjs/common';
import { isIP } from 'net';
import * as Ip2Region from 'ip2region-ts';
import UAParser from 'ua-parser-js';

export interface CommentClientInfo {
  ip: string;
  ua: string;
  location: string;
  browser: string;
  os: string;
}

const UNKNOWN_LOCATION = '未知地区';
const LOCAL_LOCATION = '本地网络';

function normalizeIp(value: unknown): string {
  let ip = String(value || 'unknown')
    .trim()
    .slice(0, 128);
  const zoneIndex = ip.indexOf('%');
  if (zoneIndex >= 0) ip = ip.slice(0, zoneIndex);
  if (ip.toLowerCase().startsWith('::ffff:') && isIP(ip.slice(7)) === 4) {
    ip = ip.slice(7);
  }
  return isIP(ip) ? ip : 'unknown';
}

function isLocalAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const parts = ip.split('.').map(Number);
    const [a, b] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    return (
      lower === '::' ||
      lower === '::1' ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') ||
      /^fe[89ab]/u.test(lower)
    );
  }
  return false;
}

function compactVersion(value?: string): string {
  return String(value || '')
    .split('.')
    .filter(Boolean)
    .slice(0, 2)
    .join('.');
}

function formatProduct(name: string | undefined, version: string | undefined, fallback: string) {
  const safeName = String(name || '').trim();
  if (!safeName) return fallback;
  const safeVersion = compactVersion(version);
  return `${safeName}${safeVersion ? ` ${safeVersion}` : ''}`.slice(0, 128);
}

function formatRegion(region: string | null): string {
  if (!region) return UNKNOWN_LOCATION;
  const parts = region.split('|').map((part) => part.trim());
  // The bundled xdb uses country|0|province|city|ISP. Newer xdb releases use
  // country|province|city|ISP|ISO, so accept both layouts.
  const locationParts = parts[1] === '0' ? [parts[0], parts[2], parts[3]] : parts.slice(0, 3);
  const compact: string[] = [];
  for (const part of locationParts) {
    if (!part || part === '0' || compact[compact.length - 1] === part) continue;
    compact.push(part);
  }
  return compact.join(' · ').slice(0, 160) || UNKNOWN_LOCATION;
}

@Injectable()
export class CommentClientInfoProvider {
  private readonly searcher: ReturnType<typeof Ip2Region.newWithBuffer> | null;

  constructor() {
    try {
      this.searcher = Ip2Region.newWithBuffer(
        Ip2Region.loadContentFromFile(Ip2Region.defaultDbFile),
      );
    } catch {
      // Location is helpful metadata, not a reason to reject a comment. A
      // missing/corrupt local database therefore degrades to an explicit
      // unknown value without making an external network request.
      this.searcher = null;
    }
  }

  async inspect(ipValue: unknown, uaValue: unknown): Promise<CommentClientInfo> {
    const ip = normalizeIp(ipValue);
    const ua = String(uaValue || '')
      .replace(/[\r\n\u0000]/gu, '')
      .slice(0, 512);
    const parsed = new UAParser(ua).getResult();
    let location = ip === 'unknown' ? UNKNOWN_LOCATION : LOCAL_LOCATION;
    if (ip !== 'unknown' && !isLocalAddress(ip) && this.searcher) {
      try {
        location = formatRegion((await this.searcher.search(ip)).region);
      } catch {
        location = UNKNOWN_LOCATION;
      }
    }
    return {
      ip,
      ua,
      location,
      browser: formatProduct(parsed.browser.name, parsed.browser.version, '未知浏览器'),
      os: formatProduct(parsed.os.name, parsed.os.version, '未知系统'),
    };
  }
}

export const commentClientInfoInternals = { formatRegion, isLocalAddress, normalizeIp };
