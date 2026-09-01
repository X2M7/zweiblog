import { SiteMetaController } from './site.meta.controller';

describe('SiteMetaController availability', () => {
  const makeController = () => {
    const metaProvider = {
      getSiteInfo: jest.fn().mockResolvedValue({ siteName: 'ZweiBlog' }),
      updateSiteInfo: jest.fn().mockResolvedValue({ acknowledged: true }),
    };
    const isrProvider = {
      activeAll: jest.fn(),
    };
    const pipelineProvider = {
      dispatchEvent: jest.fn(),
    };

    return {
      controller: new SiteMetaController(
        metaProvider as any,
        isrProvider as any,
        pipelineProvider as any,
      ),
      metaProvider,
      isrProvider,
      pipelineProvider,
    };
  };

  it('updates metadata and revalidates pages without restarting the website process', async () => {
    const { controller, metaProvider, isrProvider, pipelineProvider } = makeController();
    const dto = { copyrightAggreement: 'CC BY-NC-SA 4.0', showCopyRight: 'true' as const };

    await expect(controller.update(dto)).resolves.toEqual({
      statusCode: 200,
      data: { acknowledged: true },
    });
    expect(metaProvider.updateSiteInfo).toHaveBeenCalledWith(dto);
    expect(pipelineProvider.dispatchEvent).toHaveBeenCalledWith('updateSiteInfo', dto);
    expect(isrProvider.activeAll).toHaveBeenCalledTimes(1);
  });
});
