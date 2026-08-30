import { CanActivate, ExecutionContext, HttpException, Injectable, Logger } from '@nestjs/common';
import { Request } from 'express';
import { LoginSetting, defaultLoginSetting } from 'src/types/setting.dto';
import { RateLimitProvider, rateLimitKeyHash } from '../rateLimit/rateLimit.provider';
import { SettingProvider } from '../setting/setting.provider';

@Injectable()
export class LoginGuard implements CanActivate {
  private readonly logger = new Logger(LoginGuard.name);

  constructor(
    private readonly rateLimitProvider: RateLimitProvider,
    private readonly settingProvider: SettingProvider,
  ) {}

  async canActivate(context: ExecutionContext) {
    return this.validateRequest(context.switchToHttp().getRequest<Request>());
  }

  private normalizeSetting(setting?: Partial<LoginSetting>): LoginSetting {
    const maxRetryTimes = Number(setting?.maxRetryTimes);
    const durationSeconds = Number(setting?.durationSeconds);
    const expiresIn = Number(setting?.expiresIn);
    return {
      enableMaxLoginRetry:
        typeof setting?.enableMaxLoginRetry === 'boolean'
          ? setting.enableMaxLoginRetry
          : defaultLoginSetting.enableMaxLoginRetry,
      maxRetryTimes:
        Number.isFinite(maxRetryTimes) && maxRetryTimes > 0
          ? Math.min(Math.floor(maxRetryTimes), 100)
          : defaultLoginSetting.maxRetryTimes,
      durationSeconds:
        Number.isFinite(durationSeconds) && durationSeconds > 0
          ? Math.min(Math.floor(durationSeconds), 86_400)
          : defaultLoginSetting.durationSeconds,
      expiresIn:
        Number.isFinite(expiresIn) && expiresIn > 0
          ? Math.floor(expiresIn)
          : defaultLoginSetting.expiresIn,
    };
  }

  private async getSetting() {
    return this.normalizeSetting(await this.settingProvider.getLoginSetting());
  }

  private getIdentity(request: Request) {
    // req.ip is derived using the explicit trusted-proxy policy in main.ts.
    const ip = String(request.ip || request.socket?.remoteAddress || 'unknown').trim().slice(0, 128);
    const username = String(request.body?.username || '')
      .normalize('NFKC')
      .trim()
      .toLowerCase()
      .slice(0, 128);
    return `${ip}\0${username}`;
  }

  async validateRequest(request: Request) {
    const setting = await this.getSetting();
    if (!setting.enableMaxLoginRetry) return true;

    const identity = this.getIdentity(request);
    const result = await this.rateLimitProvider.consume(
      'login',
      identity,
      setting.maxRetryTimes,
      setting.durationSeconds,
    );
    if (!result.allowed) {
      this.logger.warn(
        `登录限流已触发，标识=${rateLimitKeyHash('login', identity).slice(0, 12)}`,
      );
      throw new HttpException(
        {
          statusCode: 429,
          message: `登录尝试过于频繁，请在 ${result.retryAfterSeconds} 秒后重试。`,
          retryAfter: result.retryAfterSeconds,
        },
        429,
      );
    }
    return true;
  }

  async clearFailures(request: Request) {
    await this.rateLimitProvider.clear('login', this.getIdentity(request));
  }
}
