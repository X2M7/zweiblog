import { BadRequestException } from '@nestjs/common';
import { ArticleSchema } from 'src/scheme/article.schema';
import { DraftSchema } from 'src/scheme/draft.schema';
import { ARTICLE_SUMMARY_MAX_LENGTH, assertLocalizedArticleFields } from './localizedArticleFields';

describe('localized article fields', () => {
  it('accepts optional bilingual text and the summary boundary', () => {
    expect(() => assertLocalizedArticleFields({})).not.toThrow();
    expect(() =>
      assertLocalizedArticleFields({
        titleEn: 'English title',
        contentEn: '# English body',
        summary: '中'.repeat(ARTICLE_SUMMARY_MAX_LENGTH),
        summaryEn: 'a'.repeat(ARTICLE_SUMMARY_MAX_LENGTH),
      }),
    ).not.toThrow();
  });

  it.each(['titleEn', 'contentEn', 'summary', 'summaryEn'])(
    'rejects a non-string %s value before Mongoose can cast it',
    (field) => {
      expect(() => assertLocalizedArticleFields({ [field]: { $ne: '' } })).toThrow(
        BadRequestException,
      );
    },
  );

  it.each(['summary', 'summaryEn'])('rejects an oversized %s', (field) => {
    expect(() =>
      assertLocalizedArticleFields({ [field]: 'a'.repeat(ARTICLE_SUMMARY_MAX_LENGTH + 1) }),
    ).toThrow(`Article ${field} must contain at most ${ARTICLE_SUMMARY_MAX_LENGTH} characters`);
  });

  it('keeps article and draft schema defaults compatible with records that lack new fields', () => {
    for (const typedSchema of [ArticleSchema, DraftSchema]) {
      const schema: any = typedSchema;
      expect(schema.path('titleEn').getDefault(undefined, false)).toBe('');
      expect(schema.path('contentEn').getDefault(undefined, false)).toBe('');
      expect(schema.path('summary').getDefault(undefined, false)).toBe('');
      expect(schema.path('summaryEn').getDefault(undefined, false)).toBe('');
      expect(schema.path('summary').options.maxlength).toBe(ARTICLE_SUMMARY_MAX_LENGTH);
      expect(schema.path('summaryEn').options.maxlength).toBe(ARTICLE_SUMMARY_MAX_LENGTH);
    }
  });
});
