import { BadRequestException } from '@nestjs/common';
import { CaddyController } from './caddy.controller';

const makeController = (internalHttpsEnabled: boolean) => {
  const settingProvider = {
    getHttpsSetting: jest.fn().mockResolvedValue({ redirect: true }),
    updateHttpsSetting: jest.fn().mockResolvedValue(undefined),
  };
  const caddyProvider = {
    isInternalHttpsEnabled: jest.fn().mockReturnValue(internalHttpsEnabled),
    setRedirect: jest.fn().mockResolvedValue('ok'),
  };
  const metaProvider = {};
  return {
    controller: new CaddyController(
      settingProvider as any,
      caddyProvider as any,
      metaProvider as any,
    ),
    settingProvider,
    caddyProvider,
  };
};

describe('CaddyController HTTPS mode boundary', () => {
  it('reports external mode and never exposes a stale redirect as enabled', async () => {
    const { controller } = makeController(false);

    await expect(controller.getHttpsConfig()).resolves.toEqual({
      statusCode: 200,
      data: {
        redirect: false,
        internalHttpsEnabled: false,
      },
    });
  });

  it('returns an HTTP error before enabling redirects in external mode', async () => {
    const { controller, caddyProvider, settingProvider } = makeController(false);

    await expect(controller.updateHttpsConfig({ redirect: true })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(caddyProvider.setRedirect).not.toHaveBeenCalled();
    expect(settingProvider.updateHttpsSetting).not.toHaveBeenCalled();
  });

  it('allows explicit on-demand mode to update redirects', async () => {
    const { controller, caddyProvider, settingProvider } = makeController(true);

    await expect(controller.updateHttpsConfig({ redirect: true })).resolves.toEqual({
      statusCode: 200,
      data: '更新成功！',
    });
    expect(caddyProvider.setRedirect).toHaveBeenCalledWith(true);
    expect(settingProvider.updateHttpsSetting).toHaveBeenCalledWith({ redirect: true });
  });
});
