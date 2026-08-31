import { DraftProvider } from './draft.provider';

const makeProvider = () => {
  const savedDocuments: any[] = [];
  const draftModel: any = jest.fn().mockImplementation((data: any) => {
    const document: any = { ...data };
    document.save = jest.fn(async () => {
      savedDocuments.push(document);
      return document;
    });
    return document;
  });
  draftModel.find = jest.fn().mockReturnValue({
    sort: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }),
  });
  draftModel.updateOne = jest.fn().mockResolvedValue({ acknowledged: true });
  const articleProvider: any = { create: jest.fn().mockResolvedValue({ id: 9 }) };
  const provider = new DraftProvider(draftModel, articleProvider);
  return { provider, draftModel, articleProvider, savedDocuments };
};

describe('DraftProvider bilingual article support', () => {
  it('persists bilingual draft fields', async () => {
    const { provider, savedDocuments } = makeProvider();

    await provider.create({
      title: '中文标题',
      titleEn: 'English title',
      content: '中文正文',
      contentEn: 'English body',
      summary: '中文摘要',
      summaryEn: 'English summary',
      category: 'notes',
    });

    expect(savedDocuments[0]).toMatchObject({
      titleEn: 'English title',
      contentEn: 'English body',
      summary: '中文摘要',
      summaryEn: 'English summary',
    });
  });

  it('publishes saved bilingual fields and lets the current editor values override them', async () => {
    const { provider, articleProvider } = makeProvider();
    jest.spyOn(provider, 'getById').mockResolvedValue({
      id: 3,
      title: '旧标题',
      titleEn: 'Old title',
      content: '旧正文 <!-- more -->',
      contentEn: 'Old body',
      summary: '旧摘要',
      summaryEn: 'Old summary',
      tags: [],
      category: 'notes',
      author: 'author',
    } as any);
    jest.spyOn(provider, 'deleteById').mockResolvedValue({ acknowledged: true } as any);

    await provider.publish(3, {
      title: '当前标题',
      titleEn: 'Current title',
      content: '当前正文 <!-- more -->',
      contentEn: 'Current body',
      summary: '当前摘要',
      summaryEn: 'Current summary',
      top: 8,
    });

    expect(articleProvider.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '当前标题',
        titleEn: 'Current title',
        content: '当前正文 <!-- more -->',
        contentEn: 'Current body',
        summary: '当前摘要',
        summaryEn: 'Current summary',
        top: 8,
      }),
    );
    expect(provider.deleteById).toHaveBeenCalledWith(3);
  });

  it('restores localized drafts and accepts legacy drafts without the new fields', async () => {
    const localizedBackup = makeProvider();
    jest.spyOn(localizedBackup.provider, 'findOneByTitle').mockResolvedValue(null);
    await localizedBackup.provider.importDrafts([
      {
        id: 4,
        title: '中文草稿',
        titleEn: 'English draft',
        content: '中文正文',
        contentEn: 'English body',
        summary: '中文摘要',
        summaryEn: 'English summary',
        category: 'notes',
      } as any,
    ]);
    expect(localizedBackup.savedDocuments[0]).toMatchObject({
      titleEn: 'English draft',
      contentEn: 'English body',
      summary: '中文摘要',
      summaryEn: 'English summary',
    });

    const legacyBackup = makeProvider();
    jest.spyOn(legacyBackup.provider, 'findOneByTitle').mockResolvedValue(null);
    await expect(
      legacyBackup.provider.importDrafts([
        { id: 5, title: '旧草稿', content: '旧正文', category: 'notes' } as any,
      ]),
    ).resolves.toBeUndefined();
    expect(legacyBackup.savedDocuments[0]).toMatchObject({ title: '旧草稿' });
  });

  it('waits for an existing draft update during backup restore', async () => {
    const { provider } = makeProvider();
    jest.spyOn(provider, 'findOneByTitle').mockResolvedValue({ id: 4 } as any);
    const restoredUpdatedAt = new Date('2026-06-01T00:00:00.000Z');
    let finishUpdate: () => void;
    const updateFinished = new Promise<void>((resolve) => {
      finishUpdate = resolve;
    });
    jest.spyOn(provider, 'updateById').mockImplementation(async () => {
      await updateFinished;
      return { acknowledged: true } as any;
    });

    let importSettled = false;
    const importing = provider
      .importDrafts([
        {
          id: 4,
          title: '现有草稿',
          category: 'notes',
          updatedAt: restoredUpdatedAt,
        } as any,
      ])
      .then(() => {
        importSettled = true;
      });
    await Promise.resolve();

    expect(importSettled).toBe(false);
    finishUpdate!();
    await importing;
    expect(importSettled).toBe(true);
    expect(provider.updateById).toHaveBeenCalledWith(
      4,
      expect.objectContaining({ updatedAt: restoredUpdatedAt, deleted: false }),
    );
  });

  it('preserves an explicitly restored draft timestamp', async () => {
    const { provider, draftModel } = makeProvider();
    const restoredUpdatedAt = new Date('2026-06-01T00:00:00.000Z');

    await provider.updateById(4, { title: '恢复草稿', updatedAt: restoredUpdatedAt });

    expect(draftModel.updateOne).toHaveBeenCalledWith(
      { id: 4 },
      expect.objectContaining({ title: '恢复草稿', updatedAt: restoredUpdatedAt }),
    );
  });
});
