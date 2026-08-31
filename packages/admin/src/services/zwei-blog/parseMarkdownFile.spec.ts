import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/zwei-blog/api', () => ({
  getAllCategories: vi.fn(async () => ({ data: ['随笔'] })),
}));

vi.mock('antd', () => ({
  message: { error: vi.fn() },
  Modal: { error: vi.fn() },
}));

import {
  needsPrivateImportPassword,
  parseMarkdownFile,
  parseObjToMarkdown,
} from './parseMarkdownFile';

describe('bilingual Markdown import and export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('round-trips Chinese and English article fields', async () => {
    const markdown = parseObjToMarkdown({
      title: '中文标题',
      titleEn: 'English title',
      summary: '中文摘要',
      summaryEn: 'English\nsummary',
      content: '# 中文正文',
      contentEn: '# English body\n\nWith a second paragraph.',
      category: '随笔',
      tags: ['双语'],
    });
    const parsed = await parseMarkdownFile({
      name: 'bilingual.md',
      text: async () => markdown,
    });

    expect(parsed).toEqual(
      expect.objectContaining({
        title: '中文标题',
        titleEn: 'English title',
        summary: '中文摘要',
        summaryEn: 'English\nsummary',
        content: '# 中文正文',
        contentEn: '# English body\n\nWith a second paragraph.',
        category: '随笔',
        tags: ['双语'],
      }),
    );
  });

  it('keeps legacy single-language Markdown compatible', async () => {
    const parsed = await parseMarkdownFile({
      name: 'legacy.md',
      text: async () => '---\ntitle: Legacy\ncategory: "随笔"\n---\n\nLegacy body',
    });

    expect(parsed).toEqual(
      expect.objectContaining({
        title: 'Legacy',
        titleEn: '',
        summary: '',
        summaryEn: '',
        contentEn: '',
        content: 'Legacy body',
      }),
    );
  });

  it('round-trips the private marker without exporting a password or hash', async () => {
    const markdown = parseObjToMarkdown({
      title: '私密文章',
      content: '私密正文',
      private: true,
      password: 'scrypt$v1$must-never-leave-the-server',
    });

    expect(markdown).toContain('private: true');
    expect(markdown).not.toContain('password:');
    expect(markdown).not.toContain('must-never-leave-the-server');

    const parsed = await parseMarkdownFile({
      name: 'private.md',
      text: async () => markdown,
    });
    expect(parsed).toMatchObject({ private: true, password: undefined });
    expect(needsPrivateImportPassword(parsed)).toBe(true);
  });

  it('keeps manually supplied legacy plaintext passwords importable', async () => {
    const parsed = await parseMarkdownFile({
      name: 'protected.md',
      text: async () =>
        '---\ntitle: "Protected"\nprivate: true\npassword: "new-local-password"\ncategory: "随笔"\n---\n\nBody',
    });

    expect(parsed).toMatchObject({
      private: true,
      password: 'new-local-password',
    });
    expect(needsPrivateImportPassword(parsed)).toBe(false);
  });

  it.each([
    ['true', true],
    ['"true"', true],
    ['1', true],
    ['"1"', true],
    ['yes', true],
    ['on', true],
    ['"unexpected-non-empty-value"', true],
    ['false', false],
    ['0', false],
    ['""', false],
    ['no', false],
    ['off', false],
  ])('parses fail-safe private marker %s as %s', async (privateValue, expected) => {
    const parsed = await parseMarkdownFile({
      name: 'privacy-marker.md',
      text: async () =>
        `---\ntitle: "Privacy marker"\nprivate: ${privateValue}\ncategory: "随笔"\n---\n\nBody`,
    });

    expect(parsed.private).toBe(expected);
  });
});
