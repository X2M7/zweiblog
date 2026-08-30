import { BadRequestException } from '@nestjs/common';

export function escapeRegexLiteral(value: string, maxLength = 100) {
  if (typeof value !== 'string') {
    throw new BadRequestException('Search value must be a string');
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new BadRequestException(`Search value must contain 1-${maxLength} characters`);
  }
  return normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
