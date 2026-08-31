export type EditorLanguage = 'zh' | 'en';

export const SUMMARY_MAX_LENGTH = 2_000;

export interface BilingualEditorDocument {
  title: string;
  summary: string;
  content: string;
  titleEn: string;
  summaryEn: string;
  contentEn: string;
}

export interface BilingualEditorCache extends Partial<BilingualEditorDocument> {
  version?: number;
  time?: number;
}

export const BILINGUAL_EDITOR_FIELDS: Array<keyof BilingualEditorDocument> = [
  'title',
  'summary',
  'content',
  'titleEn',
  'summaryEn',
  'contentEn',
];

const asText = (value: unknown): string => (typeof value === 'string' ? value : '');

export const normalizeBilingualDocument = (source: unknown): BilingualEditorDocument => {
  const document = source && typeof source === 'object' ? (source as Record<string, unknown>) : {};

  return {
    title: asText(document.title),
    summary: asText(document.summary),
    content: asText(document.content),
    titleEn: asText(document.titleEn),
    summaryEn: asText(document.summaryEn),
    contentEn: asText(document.contentEn),
  };
};

export const mergeEditorCache = (
  cache: BilingualEditorCache | undefined,
  serverDocument: unknown,
): BilingualEditorDocument => {
  const merged = normalizeBilingualDocument(serverDocument);
  if (!cache || typeof cache !== 'object') return merged;

  for (const field of BILINGUAL_EDITOR_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(cache, field) && typeof cache[field] === 'string') {
      merged[field] = cache[field] as string;
    }
  }
  return merged;
};

export const createEditorCache = (
  document: BilingualEditorDocument,
  time = Date.now(),
): BilingualEditorCache => ({
  version: 2,
  time,
  ...normalizeBilingualDocument(document),
});

export const shouldRestoreEditorCache = (
  cache: BilingualEditorCache | undefined,
  serverDocument: unknown,
  updatedAt: unknown,
): boolean => {
  if (!cache || typeof cache !== 'object') return false;

  const hasLocalizedValue = BILINGUAL_EDITOR_FIELDS.some((field) =>
    Object.prototype.hasOwnProperty.call(cache, field),
  );
  if (!hasLocalizedValue || typeof cache.time !== 'number' || !Number.isFinite(cache.time)) {
    return false;
  }

  const serverUpdatedAt = new Date(updatedAt as string | number | Date).valueOf();
  if (!Number.isFinite(serverUpdatedAt) || serverUpdatedAt > cache.time) return false;

  const server = normalizeBilingualDocument(serverDocument);
  const restored = mergeEditorCache(cache, serverDocument);
  return BILINGUAL_EDITOR_FIELDS.some((field) => restored[field] !== server[field]);
};

export const getLanguageFields = (language: EditorLanguage) =>
  language === 'en'
    ? ({ title: 'titleEn', summary: 'summaryEn', content: 'contentEn' } as const)
    : ({ title: 'title', summary: 'summary', content: 'content' } as const);

export const getLanguageStatus = (
  document: BilingualEditorDocument,
  language: EditorLanguage,
): 'empty' | 'partial' | 'complete' => {
  const fields = getLanguageFields(language);
  const title = document[fields.title].trim();
  const summary = document[fields.summary].trim();
  const content = document[fields.content].trim();
  if (!title && !summary && !content) return 'empty';
  if (title && content) return 'complete';
  return 'partial';
};

export const getContentLanguageStatus = (
  document: BilingualEditorDocument,
  language: EditorLanguage,
): 'empty' | 'complete' => {
  const { content } = getLanguageFields(language);
  return document[content].trim() ? 'complete' : 'empty';
};

export const mergeBilingualMetadata = (
  document: BilingualEditorDocument,
  metadata: unknown,
): BilingualEditorDocument => {
  const next = { ...document };
  if (!metadata || typeof metadata !== 'object') return next;

  for (const field of ['title', 'summary', 'titleEn', 'summaryEn'] as const) {
    const value = (metadata as Record<string, unknown>)[field];
    if (typeof value === 'string') next[field] = value;
  }
  return next;
};

export const selectImportedContent = (
  importedDocument: unknown,
  language: EditorLanguage,
): string => {
  const document = normalizeBilingualDocument(importedDocument);
  return language === 'en' ? document.contentEn || document.content : document.content;
};

export const getLocalizedPreviewUrl = (url: string, language: EditorLanguage): string => {
  if (language !== 'en') return url;
  return `${url}${url.includes('?') ? '&' : '?'}lang=en`;
};

export const buildBilingualSavePayload = (
  document: BilingualEditorDocument,
): BilingualEditorDocument => normalizeBilingualDocument(document);

export const needsLocalizedMetadataHydration = (source: unknown): boolean => {
  if (!source || typeof source !== 'object') return true;
  return !['summary', 'summaryEn'].every((field) =>
    Object.prototype.hasOwnProperty.call(source, field),
  );
};
