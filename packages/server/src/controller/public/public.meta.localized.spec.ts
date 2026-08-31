import { PublicController } from './public.controller';

describe('PublicController localized meta', () => {
  it('returns normalized link-page content alongside the existing link list', async () => {
    const articleProvider: any = { getTotalNum: jest.fn().mockResolvedValue(1) };
    const categoryProvider: any = {
      getAllCategories: jest.fn().mockResolvedValue(['notes']),
      getCategoryDetails: jest.fn().mockResolvedValue([{ name: 'notes', nameEn: 'Notes' }]),
    };
    const tagProvider: any = {
      getAllTags: jest.fn().mockResolvedValue(['test']),
      getTagDetails: jest.fn().mockResolvedValue([{ name: 'test', nameEn: 'Test' }]),
    };
    const links = [{ name: '伙伴', nameEn: 'Partner' }];
    const linkPage = {
      content: '申请友链说明',
      contentEn: 'Link application instructions',
    };
    const metaProvider: any = {
      getAll: jest.fn().mockResolvedValue({ viewer: 3 }),
      getSiteInfo: jest.fn().mockResolvedValue({ siteName: '博客' }),
      getAbout: jest.fn().mockResolvedValue({ content: '关于' }),
      getLinks: jest.fn().mockResolvedValue(links),
      getLinkPage: jest.fn().mockResolvedValue(linkPage),
      getTotalWords: jest.fn().mockResolvedValue(20),
    };
    const settingProvider: any = {
      getMenuSetting: jest.fn().mockResolvedValue({ data: [] }),
      getLayoutSetting: jest.fn().mockResolvedValue(null),
      encodeLayoutSetting: jest.fn(),
    };
    const unused: any = {};
    const controller = new PublicController(
      articleProvider,
      categoryProvider,
      tagProvider,
      metaProvider,
      unused,
      settingProvider,
      unused,
      unused,
    );

    const result = await controller.getBuildMeta();

    expect(result.data.meta).toMatchObject({ links, linkPage });
    expect(metaProvider.getLinks).toHaveBeenCalledTimes(1);
    expect(metaProvider.getLinkPage).toHaveBeenCalledTimes(1);
  });
});
