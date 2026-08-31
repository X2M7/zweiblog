import axios from 'axios';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { config } from 'src/config';
import { CaddyProvider } from './caddy.provider';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

const makeProvider = (settingProvider: Record<string, jest.Mock> = {}) => {
  const provider = Object.create(CaddyProvider.prototype) as CaddyProvider;
  Object.assign(provider, {
    subjects: [],
    logger: {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    settingProvider,
  });
  return provider;
};

describe('CaddyProvider HTTPS mode boundary', () => {
  const originalMode = config.caddy.httpsMode;
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    config.caddy.httpsMode = originalMode;
    while (temporaryDirectories.length) {
      rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
    }
    jest.clearAllMocks();
  });

  it('rejects enabling Caddy redirects in external reverse-proxy mode', async () => {
    config.caddy.httpsMode = 'off';
    const provider = makeProvider();

    await expect(provider.setRedirect(true)).resolves.toBe(false);
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(mockedAxios.delete).not.toHaveBeenCalled();
  });

  it('treats disabling Caddy redirects as an idempotent no-op in external mode', async () => {
    config.caddy.httpsMode = 'off';
    const provider = makeProvider();

    await expect(provider.setRedirect(false)).resolves.toBe(
      '外部反向代理模式下内置 HTTPS 已保持关闭',
    );
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(mockedAxios.delete).not.toHaveBeenCalled();
  });

  it('repairs a stale redirect setting without touching removed TLS config', async () => {
    config.caddy.httpsMode = 'off';
    const settingProvider = {
      getHttpsSetting: jest.fn().mockResolvedValue({ redirect: true }),
      updateHttpsSetting: jest.fn().mockResolvedValue(undefined),
    };
    const provider = makeProvider(settingProvider);

    await provider.init();

    expect(settingProvider.updateHttpsSetting).toHaveBeenCalledWith({ redirect: false });
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(mockedAxios.patch).not.toHaveBeenCalled();
    expect(mockedAxios.delete).not.toHaveBeenCalled();
  });

  it('allows redirect changes only when bundled on-demand HTTPS is explicit', async () => {
    config.caddy.httpsMode = 'on-demand';
    mockedAxios.post.mockResolvedValue({ status: 200 });
    mockedAxios.delete.mockResolvedValue({ status: 200 });
    const provider = makeProvider();

    await expect(provider.setRedirect(true)).resolves.toBe('开启成功！');
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'http://127.0.0.1:2019/config/apps/http/servers/srv1/listener_wrappers',
      [{ wrapper: 'http_redirect' }],
    );

    await expect(provider.setRedirect(false)).resolves.toBe('关闭成功！');
    expect(mockedAxios.delete).toHaveBeenCalledWith(
      'http://127.0.0.1:2019/config/apps/http/servers/srv1/listener_wrappers',
    );
  });

  it('does not call removed TLS configuration endpoints in external mode', async () => {
    config.caddy.httpsMode = 'off';
    const provider = makeProvider();

    await expect(provider.getSubjects()).resolves.toEqual([]);
    await expect(provider.getAutomaticDomains()).resolves.toEqual([]);
    await expect(provider.updateSubjects(['blog.example.com'])).resolves.toBe(false);
    await expect(provider.updateHttpsDomains(['blog.example.com'])).resolves.toBe(false);
    expect(mockedAxios.get).not.toHaveBeenCalled();
    expect(mockedAxios.patch).not.toHaveBeenCalled();
  });

  it('clears current and rotated Caddy access logs without touching unrelated files', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zweiblog-caddy-logs-'));
    temporaryDirectories.push(directory);
    const files = {
      caddy: join(directory, 'caddy.log'),
      access: join(directory, 'zweiblog-access.log'),
      rotatedCaddy: join(directory, 'caddy-2026-09-01.log.gz'),
      rotatedAccess: join(directory, 'zweiblog-access-2026-09-01.log.gz'),
      unrelated: join(directory, 'zweiblog-stdio.log'),
    };
    for (const file of Object.values(files)) writeFileSync(file, 'sensitive-value');

    const provider = makeProvider();
    Object.assign(provider, {
      logDirectory: directory,
      logPath: files.caddy,
      accessLogPath: files.access,
    });
    provider.clearLog();

    expect(readFileSync(files.caddy, 'utf8')).toBe('');
    expect(readFileSync(files.access, 'utf8')).toBe('');
    expect(() => readFileSync(files.rotatedCaddy)).toThrow();
    expect(() => readFileSync(files.rotatedAccess)).toThrow();
    expect(readFileSync(files.unrelated, 'utf8')).toBe('sensitive-value');
  });
});
