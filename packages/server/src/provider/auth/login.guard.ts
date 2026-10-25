import { CanActivate, ExecutionContext, HttpException, Injectable, Logger } from '@nestjs/common';
import { Request } from 'express';
import { LoginSetting, defaultLoginSetting } from 'src/types/setting.dto';
import { RateLimitProvider, rateLimitKeyHash } from '../rateLimit/rateLimit.provider';
import { SettingProvider } from '../setting/setting.provider';
import { loginCredentials } from './login.credentials';

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

  private getIp(request: Request) {
    // req.ip is derived using the explicit trusted-proxy policy in main.ts.
    return String(request.ip || request.socket?.remoteAddress || 'unknown')
      .trim()
      .slice(0, 128);
  }

  private getIdentity(request: Request) {
    const username = loginCredentials(request)
      .username.normalize('NFKC')
      .trim()
      .toLowerCase()
      .slice(0, 128);
    return `${this.getIp(request)}\0${username}`;
  }

  async validateRequest(request: Request) {
    loginCredentials(request);
    // These abuse budgets are always active and precede both settings lookup
    // and username-specific buckets. Disabling account retry limiting below
    // does not disable the fixed IP/site request and storage protections.
    await this.consumeLimit('login-global', 'site', 300, 60);
    await this.consumeLimit('login-ip', this.getIp(request), 30, 60);
    const setting = await this.getSetting();
    if (!setting.enableMaxLoginRetry) return true;

    await this.consumeLimit(
      'login',
      this.getIdentity(request),
      setting.maxRetryTimes,
      setting.durationSeconds,
    );
    return true;
  }

  private async consumeLimit(scope: string, identity: string, attempts: number, seconds: number) {
    const result = await this.rateLimitProvider.consume(scope, identity, attempts, seconds);
    if (!result.allowed) {
      this.logger.warn(`登录限流已触发，标识=${rateLimitKeyHash(scope, identity).slice(0, 12)}`);
      throw new HttpException(
        {
          statusCode: 429,
          message: `登录尝试过于频繁，请在 ${result.retryAfterSeconds} 秒后重试。`,
          retryAfter: result.retryAfterSeconds,
        },
        429,
      );
    }
  }

  async clearFailures(request: Request) {
    await this.rateLimitProvider.clear('login', this.getIdentity(request));
  }
}
