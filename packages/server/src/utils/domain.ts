import { domainToASCII } from 'node:url';
import { isIP } from 'node:net';

/** Normalize an exact DNS hostname for security-sensitive allowlist checks. */
export function normalizeDomain(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\.+$/, '');
  if (!trimmed || trimmed.length > 253 || trimmed.includes(':')) return null;

  const ascii = domainToASCII(trimmed).toLowerCase();
  if (!ascii || ascii.length > 253 || isIP(ascii)) return null;

  const labels = ascii.split('.');
  if (
    labels.length < 2 ||
    labels.some(
      (label) =>
        !label ||
        label.length > 63 ||
        !/^[a-z0-9-]+$/.test(label) ||
        label.startsWith('-') ||
        label.endsWith('-'),
    )
  ) {
    return null;
  }
  return ascii;
}

export function domainFromUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return normalizeDomain(url.hostname);
  } catch {
    return null;
  }
}
