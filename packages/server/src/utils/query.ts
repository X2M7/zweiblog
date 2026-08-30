import { BadRequestException } from '@nestjs/common';

export function parseQueryBoolean(value: unknown, defaultValue = false): boolean {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  throw new BadRequestException('Invalid boolean query value');
}

export function parseBoundedInteger(
  value: unknown,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || value === null || value === '') return defaultValue;
  const normalized = String(value);
  if (!/^-?\d+$/.test(normalized)) throw new BadRequestException('Invalid integer query value');
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new BadRequestException('Integer query value is out of range');
  }
  return parsed;
}

export function parseOptionalQueryString(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > maxLength || value.includes('\0')) {
    throw new BadRequestException('Invalid string query value');
  }
  return value;
}
