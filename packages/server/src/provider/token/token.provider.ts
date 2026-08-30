import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { JwtService } from '@nestjs/jwt';
import { TokenDocument } from 'src/scheme/token.schema';
import { SettingProvider } from '../setting/setting.provider';
import {
  API_TOKEN_USER_ID,
  hashToken,
  isTokenRecordExpired,
  normalizeApiTokenName,
  normalizeApiTokenTtlDays,
  tokenExpiresAt,
} from './token.security';

interface StoredTokenRecord {
  _id: any;
  token?: string;
  createdAt?: Date;
  expiresAt?: Date;
  expiresIn?: number;
}

@Injectable()
export class TokenProvider {
  logger = new Logger(TokenProvider.name);
  timer = null;

  constructor(
    @InjectModel('Token') private tokenModel: Model<TokenDocument>,
    private readonly jwtService: JwtService,
    private readonly settingProvider: SettingProvider,
  ) {}

  async getAllAPIToken() {
    this.logger.log('获取所有 API Token 元数据');
    // Inclusion projection is deliberate: neither legacy plaintext tokens nor
    // new token digests can be serialized by this endpoint.
    return await this.tokenModel
      .find({ userId: API_TOKEN_USER_ID, disabled: false }, { _id: 1, name: 1, createdAt: 1 })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  }

  private apiTokenName(name: unknown) {
    try {
      return normalizeApiTokenName(name);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  private apiTokenTtlDays(days: unknown) {
    try {
      return normalizeApiTokenTtlDays(days);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  private updateMatched(result: any) {
    return (result?.matchedCount ?? result?.n ?? result?.modifiedCount ?? 0) > 0;
  }

  private legacyExpiry(record: StoredTokenRecord) {
    if (record.expiresAt) return record.expiresAt;
    if (record.createdAt && Number.isFinite(record.expiresIn)) {
      return tokenExpiresAt(new Date(record.createdAt), record.expiresIn);
    }
    return undefined;
  }

  private async migrateLegacyToken(record: StoredTokenRecord, rawToken: string, digest: string) {
    const set: Record<string, any> = { tokenHash: digest };
    const expiresAt = this.legacyExpiry(record);
    if (expiresAt) set.expiresAt = expiresAt;
    return await this.tokenModel.updateOne(
      { _id: record._id, token: rawToken },
      { $set: set, $unset: { token: 1 } },
    );
  }

  private async disableStoredRecord(record: StoredTokenRecord) {
    const set: Record<string, any> = { disabled: true };
    if (record.token) {
      set.tokenHash = hashToken(record.token);
      const expiresAt = this.legacyExpiry(record);
      if (expiresAt) set.expiresAt = expiresAt;
    }
    const update: Record<string, any> = { $set: set };
    if (record.token) update.$unset = { token: 1 };
    return await this.tokenModel.updateOne({ _id: record._id }, update);
  }

  private async disableRawToken(rawToken: unknown, scope: Record<string, any> = {}) {
    if (typeof rawToken !== 'string' || rawToken.length === 0) {
      throw new BadRequestException('Token must not be empty');
    }
    const digest = hashToken(rawToken);
    const hashedResult = await this.tokenModel.updateOne(
      { ...scope, tokenHash: digest, disabled: false },
      { $set: { disabled: true } },
    );
    if (this.updateMatched(hashedResult)) return hashedResult;

    // Compatibility path for pre-migration records. Disable and replace the
    // plaintext value in one database update.
    return await this.tokenModel.updateOne(
      { ...scope, token: rawToken, disabled: false },
      { $set: { disabled: true, tokenHash: digest }, $unset: { token: 1 } },
    );
  }

  async disableAPIToken(token: string) {
    return await this.disableRawToken(token, { userId: API_TOKEN_USER_ID });
  }

  async disableAPITokenByName(name: string) {
    const safeName = this.apiTokenName(name);
    const record = await this.tokenModel
      .findOne({ userId: API_TOKEN_USER_ID, name: safeName, disabled: false })
      .select('+token')
      .exec();
    if (!record) return null;
    return await this.disableStoredRecord(record as unknown as StoredTokenRecord);
  }

  async disableAPITokenById(id: string) {
    const record = await this.tokenModel
      .findOne({ _id: id, userId: API_TOKEN_USER_ID, disabled: false })
      .select('+token')
      .exec();
    if (!record) return null;
    return await this.disableStoredRecord(record as unknown as StoredTokenRecord);
  }

  async createAPIToken(name: string, requestedTtlDays?: number) {
    const safeName = this.apiTokenName(name);
    const ttlDays = this.apiTokenTtlDays(requestedTtlDays);
    const expiresIn = ttlDays * 24 * 60 * 60;
    const createdAt = new Date();
    const expiresAt = tokenExpiresAt(createdAt, expiresIn);
    const token = this.jwtService.sign(
      {
        sub: 0,
        username: safeName,
        role: 'admin',
        jti: randomUUID(),
      },
      { expiresIn },
    );

    await this.tokenModel.create({
      userId: API_TOKEN_USER_ID,
      name: safeName,
      tokenHash: hashToken(token),
      expiresIn,
      expiresAt,
      createdAt,
    });

    // The raw token is intentionally returned only from this creation call.
    return { token, name: safeName, createdAt, expiresAt };
  }

  async createToken(payload: any) {
    this.logger.debug(`用户 ${payload.username} 登录，创建 Token。`);
    const loginSetting = await this.settingProvider.getLoginSetting();
    const expiresIn = loginSetting?.expiresIn || 3600 * 24 * 7;
    const createdAt = new Date();
    const token = this.jwtService.sign({ ...payload, jti: randomUUID() }, { expiresIn });
    await this.tokenModel.create({
      userId: payload.sub,
      tokenHash: hashToken(token),
      expiresIn,
      expiresAt: tokenExpiresAt(createdAt, expiresIn),
      createdAt,
    });
    return token;
  }

  async disableToken(token: string) {
    return await this.disableRawToken(token);
  }

  async disableAll() {
    return await this.tokenModel.updateMany({ disabled: false }, { disabled: true });
  }

  async disableAllAdmin() {
    return await this.tokenModel.updateMany({ disabled: false, userId: 0 }, { disabled: true });
  }

  async disableAllCollaborator() {
    return await this.tokenModel.updateMany(
      { disabled: false, userId: { $ne: 0 } },
      { disabled: true },
    );
  }

  async disableByUserId(id: number) {
    return await this.tokenModel.updateMany({ disabled: false, userId: id }, { disabled: true });
  }

  async checkToken(token: unknown) {
    if (typeof token !== 'string' || token.length === 0) return false;
    const digest = hashToken(token);
    const hashedRecord = await this.tokenModel
      .findOne({ tokenHash: digest, disabled: false })
      .exec();
    if (hashedRecord) return !isTokenRecordExpired(hashedRecord);

    const legacyRecord = await this.tokenModel
      .findOne({ token, disabled: false })
      .select('+token')
      .exec();
    if (!legacyRecord) return false;

    try {
      await this.migrateLegacyToken(legacyRecord as unknown as StoredTokenRecord, token, digest);
    } catch (error) {
      // A migration race or transient write error must not invalidate an
      // otherwise valid legacy session. Never include the raw token in logs.
      this.logger.warn(`旧 Token 摘要迁移失败: ${(error as Error)?.message || 'unknown error'}`);
    }
    return !isTokenRecordExpired(legacyRecord);
  }
}
