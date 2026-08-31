import { BadRequestException } from '@nestjs/common';
import { CustomPageProvider } from './customPage.provider';

describe('CustomPageProvider sandbox mode', () => {
  const findOne = jest.fn();
  const create = jest.fn();
  const updateOne = jest.fn();
  let provider: CustomPageProvider;

  beforeEach(() => {
    findOne.mockReset().mockResolvedValue(null);
    create.mockReset().mockImplementation(async (value) => value);
    updateOne.mockReset().mockResolvedValue({ acknowledged: true });
    provider = new CustomPageProvider({ findOne, create, updateOne } as any);
  });

  it('creates legacy-compatible pages in isolated mode by default', async () => {
    await expect(
      provider.createCustomPage({
        name: 'Widget',
        path: '/widget',
        type: 'file',
        html: '<script>window.ready = true</script>',
      } as any),
    ).resolves.toMatchObject({
      path: '/widget',
      sandboxMode: 'isolated',
      html: '<script>window.ready = true</script>',
    });
  });

  it('does not erase HTML or sandbox mode when a metadata edit omits them', async () => {
    await provider.updateCustomPage({ name: 'Renamed', path: '/widget' } as any);

    expect(updateOne).toHaveBeenCalledWith(
      { path: '/widget' },
      expect.not.objectContaining({ html: expect.anything(), sandboxMode: expect.anything() }),
    );
  });

  it('rejects unknown sandbox modes', async () => {
    await expect(
      provider.updateCustomPage({
        name: 'Widget',
        path: '/widget',
        sandboxMode: 'unrestricted',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
