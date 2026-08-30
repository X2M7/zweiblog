import {
  Body,
  Controller,
  Get,
  Put,
  UseGuards,
  Logger,
  Delete,
  Query,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminGuard } from 'src/provider/auth/auth.guard';
import { config } from 'src/config';
import { SettingProvider } from 'src/provider/setting/setting.provider';
import { HttpsSetting } from 'src/types/setting.dto';
import { CaddyProvider } from 'src/provider/caddy/caddy.provider';
import { ApiToken } from 'src/provider/swagger/token';
import { MetaProvider } from 'src/provider/meta/meta.provider';
import { domainFromUrl, normalizeDomain } from 'src/utils/domain';

@ApiTags('caddy')
@ApiToken
@Controller('/api/admin/caddy')
export class CaddyController {
  private readonly logger = new Logger(CaddyController.name);
  constructor(
    private readonly settingProvider: SettingProvider,
    private readonly caddyProvider: CaddyProvider,
    private readonly metaProvider: MetaProvider,
  ) {}
  @UseGuards(...AdminGuard)
  @Get('https')
  async getHttpsConfig() {
    const config = await this.settingProvider.getHttpsSetting();
    return {
      statusCode: 200,
      data: config,
    };
  }

  @Get('ask')
  async askOnDemand(@Query('domain') domain: string) {
    const requestedDomain = normalizeDomain(domain);
    const siteInfo = await this.metaProvider.getSiteInfo();
    const allowedDomains = new Set(
      [domainFromUrl(siteInfo?.baseUrl), ...config.caddy.allowedDomains.map(normalizeDomain)].filter(
        (item): item is string => Boolean(item),
      ),
    );

    if (requestedDomain && allowedDomains.has(requestedDomain)) {
      return 'domain allowed';
    }

    this.logger.warn(`拒绝未配置域名的按需证书申请：${requestedDomain || 'invalid domain'}`);
    throw new ForbiddenException();
  }
  @UseGuards(...AdminGuard)
  @Delete('log')
  async clearLog() {
    if (config.demo && config.demo == 'true') {
      return {
        statusCode: 401,
        message: '演示站禁止修改此项！',
      };
    }
    await this.caddyProvider.clearLog();
    return {
      statusCode: 200,
      data: '清除 Caddy 运行日志成功！',
    };
  }
  @UseGuards(...AdminGuard)
  @Get('log')
  async getCaddyLog() {
    const log = await this.caddyProvider.getLog();
    return {
      statusCode: 200,
      data: log,
    };
  }
  @UseGuards(...AdminGuard)
  @Get('config')
  async getCaddyConfig() {
    const caddyConfig = await this.caddyProvider.getConfig();
    return {
      statusCode: 200,
      data: JSON.stringify(caddyConfig, null, 2),
    };
  }
  @UseGuards(...AdminGuard)
  @Put('https')
  async updateHttpsConfig(@Body() dto: HttpsSetting) {
    if (config.demo && config.demo == 'true') {
      return {
        statusCode: 401,
        message: '演示站禁止修改此项！',
      };
    }
    const result = await this.caddyProvider.setRedirect(dto.redirect || false);
    if (!result) {
      return {
        statusCode: 500,
        message: '更新失败！请查看 Caddy 日志获取详细信息！',
      };
    }
    await this.settingProvider.updateHttpsSetting(dto);
    return {
      statusCode: 200,
      data: '更新成功！',
    };
  }
}
