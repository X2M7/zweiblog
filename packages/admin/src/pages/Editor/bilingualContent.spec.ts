import { describe, expect, it } from 'vitest';
import {
  buildBilingualSavePayload,
  createEditorCache,
  getContentLanguageStatus,
  getLanguageFields,
  getLanguageStatus,
  getLocalizedPreviewUrl,
  mergeBilingualMetadata,
  mergeEditorCache,
  needsLocalizedMetadataHydration,
  normalizeBilingualDocument,
  selectImportedContent,
  shouldRestoreEditorCache,
} from './bilingualContent';

describe('bilingual editor document', () => {
  it('normalizes legacy articles without inventing English content', () => {
    expect(normalizeBilingualDocument({ title: '中文', content: '正文' })).toEqual({
      title: '中文',
      summary: '',
      content: '正文',
      titleEn: '',
      summaryEn: '',
      contentEn: '',
    });
  });

  it('upgrades the legacy single-content cache while retaining server bilingual fields', () => {
    const server = {
      title: '中文',
      summary: '摘要',
      content: '服务器正文',
      titleEn: 'English',
      summaryEn: 'Summary',
      contentEn: 'Server body',
    };

    expect(mergeEditorCache({ content: '本地正文', time: 200 }, server)).toEqual({
      ...server,
      content: '本地正文',
    });
  });

  it('restores only a newer cache that differs from the server document', () => {
    const server = { title: '中文', content: '服务器正文' };
    const cache = createEditorCache(
      normalizeBilingualDocument({ ...server, contentEn: 'Unsaved English body' }),
      200,
    );

    expect(shouldRestoreEditorCache(cache, server, 100)).toBe(true);
    expect(shouldRestoreEditorCache(cache, server, 300)).toBe(false);
    expect(
      shouldRestoreEditorCache(
        createEditorCache(normalizeBilingualDocument(server), 200),
        server,
        100,
      ),
    ).toBe(false);
  });

  it('keeps every localized field in save payloads and reports language completeness', () => {
    const document = normalizeBilingualDocument({
      title: '中文',
      summary: '摘要',
      content: '正文',
      titleEn: 'English',
      summaryEn: 'Summary',
      contentEn: 'Body',
    });

    expect(buildBilingualSavePayload(document)).toEqual(document);
    expect(getLanguageFields('en')).toEqual({
      title: 'titleEn',
      summary: 'summaryEn',
      content: 'contentEn',
    });
    expect(getLanguageStatus(document, 'zh')).toBe('complete');
    expect(getLanguageStatus(document, 'en')).toBe('complete');
    expect(getLanguageStatus(normalizeBilingualDocument({ titleEn: 'Only a title' }), 'en')).toBe(
      'partial',
    );
    expect(getLanguageStatus(normalizeBilingualDocument({}), 'en')).toBe('empty');
    expect(getContentLanguageStatus(document, 'en')).toBe('complete');
    expect(
      getContentLanguageStatus(normalizeBilingualDocument({ titleEn: 'Title only' }), 'en'),
    ).toBe('empty');
  });

  it('updates metadata without replacing unsaved Chinese or English bodies', () => {
    const current = normalizeBilingualDocument({
      title: '旧标题',
      content: '未保存中文正文',
      contentEn: 'Unsaved English body',
    });

    expect(mergeBilingualMetadata(current, { title: '新标题', summaryEn: 'New summary' })).toEqual({
      ...current,
      title: '新标题',
      summaryEn: 'New summary',
    });
  });

  it('imports the real English body and builds language-specific preview URLs', () => {
    const imported = { content: '中文正文', contentEn: 'English body' };
    expect(selectImportedContent(imported, 'zh')).toBe('中文正文');
    expect(selectImportedContent(imported, 'en')).toBe('English body');
    expect(selectImportedContent({ content: 'Standalone English file' }, 'en')).toBe(
      'Standalone English file',
    );
    expect(getLocalizedPreviewUrl('/post/1', 'zh')).toBe('/post/1');
    expect(getLocalizedPreviewUrl('/post/1', 'en')).toBe('/post/1?lang=en');
    expect(getLocalizedPreviewUrl('/post/1?preview=1', 'en')).toBe('/post/1?preview=1&lang=en');
  });

  it('detects list records that need full localized metadata before editing', () => {
    expect(needsLocalizedMetadataHydration({ title: '列表标题', titleEn: 'List title' })).toBe(
      true,
    );
    expect(needsLocalizedMetadataHydration({ summary: '', summaryEn: '' })).toBe(false);
  });
});
