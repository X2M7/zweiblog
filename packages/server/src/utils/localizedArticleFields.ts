import { BadRequestException } from '@nestjs/common';

export const ARTICLE_SUMMARY_MAX_LENGTH = 2_000;

const LOCALIZED_STRING_FIELDS = ['titleEn', 'contentEn', 'summary', 'summaryEn'] as const;
const SUMMARY_FIELDS = new Set<string>(['summary', 'summaryEn']);

/**
 * DTOs in this project are compile-time types rather than class-validator
 * schemas. Keep the optional localized fields strict at the provider boundary
 * so Mongoose cannot silently cast objects or numbers into reader-facing text.
 */
export function assertLocalizedArticleFields(data: Record<string, unknown>): void {
  for (const field of LOCALIZED_STRING_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(data, field)) continue;

    const value = data[field];
    if (typeof value !== 'string') {
      throw new BadRequestException(`Article ${field} must be a string`);
    }
    if (SUMMARY_FIELDS.has(field) && value.length > ARTICLE_SUMMARY_MAX_LENGTH) {
      throw new BadRequestException(
        `Article ${field} must contain at most ${ARTICLE_SUMMARY_MAX_LENGTH} characters`,
      );
    }
  }
}
