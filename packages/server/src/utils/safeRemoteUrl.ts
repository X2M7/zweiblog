import { BadRequestException } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import { isIP } from 'node:net';

function isPublicIpv4(address: string) {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && [0, 2, 168].includes(b)) return false;
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return false;
  if (a === 203 && b === 0) return false;
  return true;
}

function isPublicIpv6(address: string) {
  const lower = address.toLowerCase().split('%')[0];
  const mappedIpv4 = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedIpv4) return isPublicIpv4(mappedIpv4);

  const firstGroup = parseInt(lower.split(':')[0] || '0', 16);
  // Only accept ordinary global-unicast space. This intentionally rejects
  // loopback, unique-local, link-local, multicast, NAT64 and transition ranges.
  if (firstGroup < 0x2000 || firstGroup > 0x3fff) return false;
  if (lower.startsWith('2001:db8:') || lower === '2001:db8::') return false;
  if (lower.startsWith('2001:0000:') || lower.startsWith('2001:0:')) return false;
  if (lower.startsWith('2002:')) return false;
  return true;
}

export function isPublicIpAddress(address: string) {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

export async function createPinnedHttpAgents(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BadRequestException('Invalid remote image URL');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new BadRequestException('Only public HTTP(S) image URLs are allowed');
  }

  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicIpAddress(address))) {
    throw new BadRequestException('Remote image URL resolves to a non-public address');
  }

  const pinnedLookup = (_hostname: string, options: any, callback: any) => {
    const requestedFamily = typeof options === 'number' ? options : options?.family;
    const candidates = requestedFamily
      ? addresses.filter(({ family }) => family === requestedFamily)
      : addresses;
    const selected = candidates[0] || addresses[0];
    if (options?.all) callback(null, candidates.length ? candidates : addresses);
    else callback(null, selected.address, selected.family);
  };

  return {
    url: url.toString(),
    httpAgent: new HttpAgent({ keepAlive: false, lookup: pinnedLookup }),
    httpsAgent: new HttpsAgent({ keepAlive: false, lookup: pinnedLookup }),
  };
}
