import { BadRequestException } from '@nestjs/common';
import { BackupController } from './backup.controller';

const makeController = () => {
  const article: any = {
    exportForBackup: jest.fn().mockResolvedValue([{ id: 1, password: 'article-hash' }]),
    importArticles: jest.fn().mockResolvedValue(undefined),
  };
  const category: any = {
    exportForBackup: jest.fn().mockResolvedValue([{ name: 'locked', password: 'category-hash' }]),
    importFromBackup: jest.fn().mockResolvedValue(undefined),
  };
  const tag: any = {
    getAllTags: jest.fn().mockResolvedValue([]),
    exportForBackup: jest.fn().mockResolvedValue([{ name: 'tag', nameEn: 'Tag' }]),
    importFromBackup: jest.fn().mockResolvedValue(undefined),
  };
  const meta: any = {
    getAll: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue(undefined),
  };
  const draft: any = {
    getAll: jest.fn().mockResolvedValue([]),
    importDrafts: jest.fn().mockResolvedValue(undefined),
  };
  const user: any = {
    exportForBackup: jest.fn().mockResolvedValue({}),
    importFromBackup: jest.fn().mockResolvedValue(undefined),
  };
  const viewer: any = {
    getAll: jest.fn().mockResolvedValue([]),
    import: jest.fn().mockResolvedValue(undefined),
  };
  const visit: any = {
    getAll: jest.fn().mockResolvedValue([]),
    import: jest.fn().mockResolvedValue(undefined),
  };
  const setting: any = {
    getStaticSetting: jest.fn().mockResolvedValue({}),
    getCommentSetting: jest.fn().mockResolvedValue({}),
    getMenuSetting: jest.fn().mockResolvedValue({ data: [] }),
    importSetting: jest.fn().mockResolvedValue(undefined),
  };
  const staticProvider: any = {
    exportAll: jest.fn().mockResolvedValue([]),
    importItems: jest.fn().mockResolvedValue(undefined),
  };
  const comment: any = {
    exportForBackup: jest.fn().mockResolvedValue([]),
    exportMigrationTombstonesForBackup: jest.fn().mockResolvedValue([]),
    validateBackup: jest.fn().mockReturnValue({ valid: 0 }),
    validateMigrationTombstonesBackup: jest.fn().mockReturnValue({ valid: 0 }),
    reconcileBackupWithMigrationTombstones: jest.fn((comments) => ({
      comments,
      suppressed: 0,
    })),
    reconcileBackupArticleTargets: jest.fn((comments) => ({ comments, quarantined: 0 })),
    preflightBackup: jest.fn().mockResolvedValue({ valid: 0 }),
    importMigrationTombstonesFromBackup: jest.fn().mockResolvedValue({ imported: 0 }),
    importFromBackup: jest.fn().mockResolvedValue({ imported: 2, skipped: 1 }),
  };
  const maintenance: any = {
    withExclusive: jest.fn((_operation, action) => action({ assertOwned: jest.fn() })),
  };
  const controller = new BackupController(
    article,
    category,
    tag,
    meta,
    draft,
    user,
    viewer,
    visit,
    setting,
    staticProvider,
    comment,
    maintenance,
  );
  return { controller, article, category, tag, comment };
};

describe('backup password round trip', () => {
  it('uses the dedicated hash-preserving exports', async () => {
    const { controller } = makeController();
    const response: any = {
      attachment: jest.fn().mockReturnThis(),
      type: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    };

    await controller.getAll(response);
    const backup = JSON.parse(response.send.mock.calls[0][0]);
    expect(backup.articles[0].password).toBe('article-hash');
    expect(backup.categories[0].password).toBe('category-hash');
    expect(backup.tagDetails).toEqual([{ name: 'tag', nameEn: 'Tag' }]);
    expect(backup.setting.menu).toEqual({ data: [] });
  });

  it('restores categories before articles so privacy metadata is available', async () => {
    const { controller, article, category, tag, comment } = makeController();
    const backup = {
      articles: [{ id: 1, private: true, password: 'article-hash' }],
      categories: [{ name: 'locked', private: true, password: 'category-hash' }],
      drafts: [],
      viewer: [],
      visit: [],
      static: [],
      comments: [],
      user: {},
      meta: {},
      setting: {},
    };

    await controller.importAll({ buffer: Buffer.from(JSON.stringify(backup)) } as any);

    expect(category.importFromBackup).toHaveBeenCalledWith(backup.categories);
    expect(article.importArticles).toHaveBeenCalledWith(backup.articles);
    expect(tag.importFromBackup).toHaveBeenCalledWith(undefined);
    expect(comment.validateBackup.mock.invocationCallOrder[0]).toBeLessThan(
      category.importFromBackup.mock.invocationCallOrder[0],
    );
    expect(comment.preflightBackup.mock.invocationCallOrder[0]).toBeLessThan(
      category.importFromBackup.mock.invocationCallOrder[0],
    );
    expect(category.importFromBackup.mock.invocationCallOrder[0]).toBeLessThan(
      article.importArticles.mock.invocationCallOrder[0],
    );
    expect(article.importArticles.mock.invocationCallOrder[0]).toBeLessThan(
      comment.importFromBackup.mock.invocationCallOrder[0],
    );
    expect(category.importFromBackup.mock.invocationCallOrder[0]).toBeLessThan(
      article.importArticles.mock.invocationCallOrder[0],
    );
  });

  it('reports processed and skipped comment records instead of a generic success string', async () => {
    const { controller, comment } = makeController();
    const backup = {
      articles: [{ id: 1, title: 'article' }],
      categories: [],
      drafts: [],
      viewer: [],
      visit: [],
      static: [],
      comments: [{ id: 'a' }, { id: 'b' }, { id: 'bad' }],
      user: {},
      meta: {},
      setting: {},
    };

    const result = await controller.importAll({
      buffer: Buffer.from(JSON.stringify(backup)),
    } as any);

    expect(comment.importFromBackup).toHaveBeenCalledWith(backup.comments);
    expect(result.data).toMatchObject({
      message: '备份导入完成',
      processed: { articles: 1, comments: 3 },
      comments: { supplied: 3, written: 2, skipped: 1 },
    });
  });

  it('rejects invalid comments before importing any other backup section', async () => {
    const { controller, article, category, comment } = makeController();
    comment.validateBackup.mockImplementation(() => {
      throw new BadRequestException('invalid comments');
    });
    const backup = {
      articles: [{ id: 1, title: 'article' }],
      categories: [],
      drafts: [],
      viewer: [],
      visit: [],
      static: [],
      comments: [{ id: 'bad' }],
      user: {},
      meta: {},
      setting: {},
    };

    await expect(
      controller.importAll({ buffer: Buffer.from(JSON.stringify(backup)) } as any),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(category.importFromBackup).not.toHaveBeenCalled();
    expect(article.importArticles).not.toHaveBeenCalled();
    expect(comment.importFromBackup).not.toHaveBeenCalled();
  });
});
