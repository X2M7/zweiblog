import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  HttpsSetting,
  ISRSetting,
  LayoutSetting,
  LoginSetting,
  MenuSetting,
  StaticSetting,
  VersionSetting,
  CommentSetting,
  defaultCommentSetting,
  defaultLoginSetting,
  defaultStaticSetting,
} from 'src/types/setting.dto';
import { SettingDocument } from 'src/scheme/setting.schema';
import { PicgoProvider } from '../static/picgo.provider';
import { encode } from 'js-base64';
import { defaultMenu, MenuItem } from 'src/types/menu.dto';
import { MetaProvider } from '../meta/meta.provider';
import { parseHtmlToHeadTagArr } from 'src/utils/htmlParser';
import { normalizeCommentSetting } from 'src/utils/comment';
@Injectable()
export class SettingProvider {
  logger = new Logger(SettingProvider.name);
  constructor(
    @InjectModel('Setting')
    private settingModel: Model<SettingDocument>,
    private readonly picgoProvider: PicgoProvider,
    private readonly metaProvider: MetaProvider,
  ) {}
  async getStaticSetting(): Promise<Partial<StaticSetting>> {
    const res = (await this.settingModel.findOne({ type: 'static' }).exec()) as {
      value: StaticSetting;
    };
    if (res) {
      return res?.value || defaultStaticSetting;
    } else {
      await this.settingModel.create({
        type: 'static',
        value: defaultStaticSetting,
      });
      return defaultStaticSetting;
    }
  }
  async getVersionSetting(): Promise<any> {
    const res = await this.settingModel.findOne({ type: 'version' }).exec();
    if (res) {
      return res?.value;
    }
    return null;
  }
  async getISRSetting(): Promise<any> {
    const res = await this.settingModel.findOne({ type: 'isr' }).exec();
    if (res) {
      return res?.value;
    } else {
      await this.settingModel.create({
        type: 'isr',
        value: {
          mode: 'onDemand',
        },
      });
      return {
        mode: 'onDemand',
      };
    }
  }
  async updateISRSetting(dto: ISRSetting) {
    const oldValue = await this.getISRSetting();
    const newValue = { ...oldValue, ...dto };
    if (!oldValue) {
      return await this.settingModel.create({
        type: 'isr',
        value: newValue,
      });
    }
    const res = await this.settingModel.updateOne({ type: 'isr' }, { value: newValue });
    return res;
  }
  async getMenuSetting(): Promise<any> {
    const res = await this.settingModel.findOne({ type: 'menu' }).exec();
    if (res) {
      return res?.value;
    }
    return null;
  }
  async updateMenuSetting(dto: MenuSetting) {
    const oldValue = await this.getMenuSetting();
    const newValue = { ...oldValue, ...dto };
    if (!oldValue) {
      return await this.settingModel.create({
        type: 'menu',
        value: newValue,
      });
    }
    const res = await this.settingModel.updateOne({ type: 'menu' }, { value: newValue });
    return res;
  }
  async importSetting(setting: any) {
    if (!setting || typeof setting !== 'object' || Array.isArray(setting)) return;
    for (const [k, v] of Object.entries(setting)) {
      if (k == 'static') {
        await this.importStaticSetting(v as any);
      } else if (k === 'comment') {
        await this.updateCommentSetting(v as Partial<CommentSetting>);
      }
    }
  }
  async importStaticSetting(dto: StaticSetting) {
    await this.updateStaticSetting(dto);
  }
  async getHttpsSetting(): Promise<HttpsSetting> {
    const res = await this.settingModel.findOne({ type: 'https' }).exec();
    if (res) {
      return (res?.value as any) || { redirect: false };
    }
    return null;
  }
  async getLayoutSetting(): Promise<LayoutSetting> {
    const res = await this.settingModel.findOne({ type: 'layout' }).exec();
    if (res) {
      return res?.value as any;
    }
    return null;
  }
  async getLoginSetting(): Promise<LoginSetting> {
    const res = await this.settingModel.findOne({ type: 'login' }).exec();
    if (res) {
      return { ...defaultLoginSetting, ...((res?.value as any) || {}) };
    }
    await this.settingModel.updateOne(
      { type: 'login' },
      { $setOnInsert: { type: 'login', value: defaultLoginSetting } },
      { upsert: true },
    );
    return { ...defaultLoginSetting };
  }
  encodeLayoutSetting(dto: LayoutSetting) {
    if (!dto) {
      return null;
    }
    const res: any = {};
    for (const key of Object.keys(dto)) {
      if (key == 'head') {
        res[key] = parseHtmlToHeadTagArr(dto[key]);
      } else {
        res[key] = encode(dto[key]);
      }
    }
    return res;
  }
  async getCommentSetting(): Promise<CommentSetting> {
    const res = await this.settingModel.findOne({ type: 'comment' }).lean().exec();
    const value = res?.value;
    if (value) {
      try {
        const normalized = normalizeCommentSetting(value, defaultCommentSetting);
        // Comment bodies and administrator replies intentionally share one
        // fixed 50k limit. Repair older 5k/10k records so restoring or
        // upgrading an existing database cannot silently re-enable the old
        // restriction.
        if (normalized.maxLength !== defaultCommentSetting.maxLength) {
          normalized.maxLength = defaultCommentSetting.maxLength;
          await this.settingModel
            .updateOne({ type: 'comment' }, { $set: { value: normalized } })
            .exec();
        }
        return normalized;
      } catch {
        this.logger.warn('评论设置无效，已使用安全默认值。');
        return { ...defaultCommentSetting };
      }
    }
    await this.settingModel.updateOne(
      { type: 'comment' },
      { $setOnInsert: { type: 'comment', value: defaultCommentSetting } },
      { upsert: true },
    );
    return { ...defaultCommentSetting };
  }

  async updateCommentSetting(dto: Partial<CommentSetting>): Promise<CommentSetting> {
    const oldValue = await this.getCommentSetting();
    const newValue = {
      ...normalizeCommentSetting(dto, oldValue),
      maxLength: defaultCommentSetting.maxLength,
    };
    await this.settingModel.updateOne(
      { type: 'comment' },
      { $set: { type: 'comment', value: newValue } },
      { upsert: true },
    );
    return newValue;
  }

  async updateLoginSetting(dto: LoginSetting) {
    const oldValue = await this.getLoginSetting();
    const newValue = { ...oldValue, ...dto };
    if (!oldValue) {
      return await this.settingModel.create({
        type: 'login',
        value: newValue,
      });
    }
    const res = await this.settingModel.updateOne({ type: 'login' }, { value: newValue });
    return res;
  }
  async updateVersionSetting(dto: VersionSetting) {
    const oldValue = await this.getVersionSetting();
    const newValue = { ...oldValue, ...dto };
    if (!oldValue) {
      return await this.settingModel.create({
        type: 'version',
        value: newValue,
      });
    }
    const res = await this.settingModel.updateOne({ type: 'version' }, { value: newValue });
    return res;
  }

  async updateLayoutSetting(dto: LayoutSetting) {
    const oldValue = await this.getLayoutSetting();
    const newValue = { ...oldValue, ...dto };
    if (!oldValue) {
      return await this.settingModel.create({
        type: 'layout',
        value: newValue,
      });
    }
    const res = await this.settingModel.updateOne({ type: 'layout' }, { value: newValue });
    return res;
  }
  async updateHttpsSetting(dto: HttpsSetting) {
    const oldValue = await this.getHttpsSetting();
    const newValue = { ...oldValue, ...dto };
    if (!oldValue) {
      return await this.settingModel.create({
        type: 'https',
        value: newValue,
      });
    }
    const res = await this.settingModel.updateOne({ type: 'https' }, { value: newValue });
    return res;
  }
  async updateStaticSetting(dto: Partial<StaticSetting>) {
    const oldValue = await this.getStaticSetting();
    const newValue = { ...oldValue, ...dto };
    if (!oldValue) {
      return await this.settingModel.create({
        type: 'static',
        value: newValue,
      });
    }
    const res = await this.settingModel.updateOne({ type: 'static' }, { value: newValue });

    await this.picgoProvider.initDriver();
    return res;
  }
  async washDefaultMenu() {
    const r = await this.settingModel.findOne({ type: 'menu' });
    if (!r) {
      // 没有的话需要清洗
      const toInsert: MenuItem[] = defaultMenu;
      const meta = await this.metaProvider.getAll();
      const oldMenus = meta.menus;
      const d = Date.now();
      oldMenus.forEach((item: any, index: number) => {
        toInsert.push({
          id: d + index,
          level: 0,
          name: item.name,
          value: item.value,
        });
      });
      await this.updateMenuSetting({ data: toInsert });
      this.logger.log('清洗老 menu 数据成功！');
    }
  }
}
