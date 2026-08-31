import { MetaProvider } from './meta.provider';
import { BadRequestException } from '@nestjs/common';

const queryResult = (value: any) => ({ exec: jest.fn().mockResolvedValue(value) });

const makeProvider = (meta: any) => {
  const metaModel: any = {
    findOne: jest.fn().mockReturnValue(queryResult(meta)),
    updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
  };
  return {
    provider: new MetaProvider(metaModel, {} as any, {} as any, {} as any, {} as any),
    metaModel,
  };
};

describe('MetaProvider localized metadata', () => {
  it('normalizes the legacy authDesc typo without losing localized site fields', async () => {
    const { provider } = makeProvider({
      siteInfo: { author: '作者', authDesc: '旧简介', siteName: '站点', siteNameEn: 'Site' },
    });

    await expect(provider.getSiteInfo()).resolves.toMatchObject({
      authorDesc: '旧简介',
      authorEn: '',
      authorDescEn: '',
      siteNameEn: 'Site',
      siteDescEn: '',
    });
  });

  it('merges old-client site updates and preserves all English fields', async () => {
    const { provider, metaModel } = makeProvider({
      siteInfo: {
        author: '作者',
        authorEn: 'Author',
        authorDesc: '简介',
        authorDescEn: 'Biography',
        siteName: '站点',
        siteNameEn: 'Site',
        siteDesc: '描述',
        siteDescEn: 'Description',
      },
    });

    await provider.updateSiteInfo({ siteName: '新站点' } as any);

    expect(metaModel.updateOne.mock.calls[0][1].siteInfo).toMatchObject({
      siteName: '新站点',
      siteNameEn: 'Site',
      authorEn: 'Author',
      authorDescEn: 'Biography',
      siteDescEn: 'Description',
    });
  });

  it('updates only supplied about languages', async () => {
    const { provider, metaModel } = makeProvider({});
    await provider.updateAbout({ content: '新的中文内容' });

    const update = metaModel.updateOne.mock.calls[0][1];
    expect(update.$set['about.content']).toBe('新的中文内容');
    expect(update.$set).not.toHaveProperty('about.contentEn');
    expect(update.$set['about.updatedAt']).toBeInstanceOf(Date);
  });

  it('normalizes a legacy meta document without link-page content', async () => {
    const { provider } = makeProvider({ links: [] });

    await expect(provider.getLinkPage()).resolves.toEqual({
      updatedAt: undefined,
      content: '',
      contentEn: '',
    });
  });

  it('updates only supplied link-page languages and refreshes its timestamp', async () => {
    const { provider, metaModel } = makeProvider({});

    await provider.updateLinkPage({ contentEn: 'Apply for a link here.' });

    const update = metaModel.updateOne.mock.calls[0][1];
    expect(update.$set['linkPage.contentEn']).toBe('Apply for a link here.');
    expect(update.$set).not.toHaveProperty('linkPage.content');
    expect(update.$set['linkPage.updatedAt']).toBeInstanceOf(Date);
  });

  it('rejects an empty link-page update instead of silently changing its timestamp', async () => {
    const { provider, metaModel } = makeProvider({});

    await expect(provider.updateLinkPage({})).rejects.toBeInstanceOf(BadRequestException);
    expect(metaModel.updateOne).not.toHaveBeenCalled();
  });

  it('preserves English link fields when an old client updates the same link', async () => {
    const { provider, metaModel } = makeProvider({
      links: [
        {
          name: '伙伴',
          nameEn: 'Partner',
          desc: '简介',
          descEn: 'Description',
          url: 'https://example.com',
          logo: 'https://example.com/logo.png',
        },
      ],
    });

    await provider.addOrUpdateLink({
      name: '伙伴',
      desc: '新简介',
      url: 'https://example.com',
      logo: 'https://example.com/logo.png',
    });

    expect(metaModel.updateOne.mock.calls[0][1].links[0]).toMatchObject({
      nameEn: 'Partner',
      desc: '新简介',
      descEn: 'Description',
    });
  });

  it('reorders every existing link without changing any link fields', async () => {
    const first = {
      name: '甲',
      nameEn: 'Alpha',
      desc: '甲简介',
      url: 'https://alpha.example',
      logo: 'alpha.png',
    };
    const second = {
      name: '乙',
      nameEn: 'Beta',
      desc: '乙简介',
      url: 'https://beta.example',
      logo: 'beta.png',
    };
    const { provider, metaModel } = makeProvider({ links: [first, second] });

    await provider.reorderLinks(['乙', '甲']);

    expect(metaModel.updateOne).toHaveBeenCalledWith({}, { links: [second, first] });
  });

  it.each([
    ['a non-array payload', { names: ['甲', '乙'] }],
    ['duplicate names', ['甲', '甲']],
    ['an omitted name', ['甲']],
    ['an unknown name', ['甲', '丙']],
    ['a non-string name', ['甲', 2]],
  ])('rejects link ordering with %s', async (_, names) => {
    const { provider, metaModel } = makeProvider({
      links: [{ name: '甲' }, { name: '乙' }],
    });

    await expect(provider.reorderLinks(names)).rejects.toBeInstanceOf(BadRequestException);
    expect(metaModel.updateOne).not.toHaveBeenCalled();
  });

  it('keeps localized metadata when importing a legacy backup that omits English fields', async () => {
    const { provider, metaModel } = makeProvider({
      siteInfo: { siteName: '站点', siteNameEn: 'Site', authorDescEn: 'Biography' },
      about: { content: '关于', contentEn: 'About' },
      linkPage: { content: '申请友链', contentEn: 'Apply for a link' },
      links: [
        {
          name: '伙伴',
          nameEn: 'Partner',
          desc: '简介',
          descEn: 'Description',
          url: 'https://example.com',
          logo: 'https://example.com/logo.png',
        },
      ],
    });

    await provider.update({
      siteInfo: { siteName: '新站点' } as any,
      about: { content: '新关于' } as any,
      linkPage: { content: '新的友链说明' } as any,
      links: [
        {
          name: '伙伴',
          desc: '新简介',
          url: 'https://example.com',
          logo: 'https://example.com/logo.png',
        },
      ] as any,
    });

    expect(metaModel.updateOne.mock.calls[0][1]).toMatchObject({
      siteInfo: { siteNameEn: 'Site', authorDescEn: 'Biography' },
      about: { content: '新关于', contentEn: 'About' },
      linkPage: { content: '新的友链说明', contentEn: 'Apply for a link' },
      links: [{ nameEn: 'Partner', descEn: 'Description' }],
    });
  });
});
