import { describe, expect, it } from 'vitest';
import { getMigrationErrorMessage, normalizeMigrationResult } from './commentMigration';

describe('comment migration result', () => {
  it('keeps created, skipped and per-record error details', () => {
    const result = normalizeMigrationResult({
      data: {
        sourceDatabase: 'waline',
        sourceCollection: 'Comment',
        scanned: 5,
        imported: 2,
        existing: 1,
        skipped: 1,
        errorCount: 1,
        errors: [{ legacyId: 'broken-1', reason: 'invalid path' }],
        skippedDetails: [{ id: 'skip-1', message: 'empty id' }],
      },
    });

    expect(result).toMatchObject({
      sourceDatabase: 'waline',
      sourceCollection: 'Comment',
      scanned: 5,
      created: 2,
      existing: 1,
      skipped: 1,
      errorCount: 1,
      errors: ['[broken-1] invalid path'],
      skippedDetails: ['[skip-1] empty id'],
    });
  });

  it('normalizes malformed counters and extracts a server error', () => {
    expect(normalizeMigrationResult({ imported: -2, skipped: 'bad' })).toMatchObject({
      created: 0,
      skipped: 0,
      errorCount: 0,
    });
    expect(
      getMigrationErrorMessage({ response: { data: { message: 'database unavailable' } } }),
    ).toBe('database unavailable');
  });
});
