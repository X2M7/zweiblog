import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { LinkMetaController } from './link.meta.controller';

describe('LinkMetaController page content API', () => {
  const makeController = () => {
    const metaProvider: any = {
      getLinkPage: jest.fn().mockResolvedValue({
        content: '申请说明',
        contentEn: 'Application instructions',
      }),
      updateLinkPage: jest.fn().mockResolvedValue({ acknowledged: true }),
      reorderLinks: jest.fn().mockResolvedValue({ acknowledged: true }),
    };
    const isrProvider: any = { activeLink: jest.fn() };
    return {
      controller: new LinkMetaController(metaProvider, isrProvider),
      metaProvider,
      isrProvider,
    };
  };

  it('exposes GET /api/admin/meta/link/page without changing the link-list GET', async () => {
    const { controller, metaProvider } = makeController();

    await expect(controller.getPage()).resolves.toEqual({
      statusCode: 200,
      data: { content: '申请说明', contentEn: 'Application instructions' },
    });
    expect(metaProvider.getLinkPage).toHaveBeenCalledTimes(1);
    expect(Reflect.getMetadata(PATH_METADATA, LinkMetaController)).toBe('/api/admin/meta/link');
    expect(Reflect.getMetadata(PATH_METADATA, controller.getPage)).toBe('/page');
    expect(Reflect.getMetadata(METHOD_METADATA, controller.getPage)).toBe(RequestMethod.GET);
  });

  it('updates page content through PUT /page and invalidates the link page', async () => {
    const { controller, metaProvider, isrProvider } = makeController();
    const dto = { content: '新说明', contentEn: 'New instructions' };

    await expect(controller.updatePage(dto)).resolves.toEqual({
      statusCode: 200,
      data: { acknowledged: true },
    });
    expect(metaProvider.updateLinkPage).toHaveBeenCalledWith(dto);
    expect(isrProvider.activeLink).toHaveBeenCalledTimes(1);
    expect(Reflect.getMetadata(PATH_METADATA, controller.updatePage)).toBe('/page');
    expect(Reflect.getMetadata(METHOD_METADATA, controller.updatePage)).toBe(RequestMethod.PUT);
  });

  it('reorders the complete link list through PUT /order and invalidates the page', async () => {
    const { controller, metaProvider, isrProvider } = makeController();
    const dto = { names: ['Beta', 'Alpha'] };

    await expect(controller.reorder(dto)).resolves.toEqual({
      statusCode: 200,
      data: { acknowledged: true },
    });
    expect(metaProvider.reorderLinks).toHaveBeenCalledWith(dto.names);
    expect(isrProvider.activeLink).toHaveBeenCalledTimes(1);
    expect(Reflect.getMetadata(PATH_METADATA, controller.reorder)).toBe('/order');
    expect(Reflect.getMetadata(METHOD_METADATA, controller.reorder)).toBe(RequestMethod.PUT);
  });
});
