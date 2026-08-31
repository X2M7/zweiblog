import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({
  deleteArticle: vi.fn(),
  deleteDraft: vi.fn(),
  getArticleById: vi.fn(async (id) => ({ data: { id, title: 'Article', content: 'article' } })),
  getDraftById: vi.fn(async (id) => ({ data: { id, title: 'Draft', content: 'draft' } })),
}));

vi.mock('./parseMarkdownFile', () => ({
  parseObjToMarkdown: vi.fn((document) => document.content),
}));
vi.mock('antd', () => ({ Modal: { confirm: vi.fn() } }));

import { getArticleById, getDraftById } from './api';
import { parseObjToMarkdown } from './parseMarkdownFile';
import { exportEachById } from './batch';

describe('batch Markdown export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({ click: vi.fn(), href: '', download: '' })),
    });
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:audit') });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads an article for an article export', async () => {
    await exportEachById('7', false);

    expect(getArticleById).toHaveBeenCalledWith('7');
    expect(getDraftById).not.toHaveBeenCalled();
    expect(parseObjToMarkdown).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Article', content: 'article' }),
    );
  });

  it('loads a draft for a draft export', async () => {
    await exportEachById('8', true);

    expect(getDraftById).toHaveBeenCalledWith('8');
    expect(getArticleById).not.toHaveBeenCalled();
    expect(parseObjToMarkdown).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Draft', content: 'draft' }),
    );
  });
});
