import { MenuItem } from './menu.dto';

export const defaultStaticSetting: StaticSetting = {
  storageType: 'local',
  picgoConfig: null,
  enableWaterMark: false,
  enableWebp: true,
  waterMarkText: null,
  picgoPlugins: null,
};

export type SettingType =
  | 'static'
  | 'https'
  | 'comment'
  | 'layout'
  | 'login'
  | 'menu'
  | 'version'
  | 'isr';

export type SettingValue =
  | StaticSetting
  | HttpsSetting
  | CommentSetting
  | LayoutSetting
  | VersionSetting
  | ISRSetting
  | LoginSetting
  | MenuSetting;

export interface CommentSetting {
  moderation: 'all' | 'suspicious' | 'off';
  pageSize: number;
  maxLength: number;
}

export const defaultCommentSetting: CommentSetting = {
  moderation: 'suspicious',
  pageSize: 10,
  maxLength: 50_000,
};

export interface ISRSetting {
  mode: 'delay' | 'onDemand';
  delay: number;
}

export interface MenuSetting {
  data: MenuItem[];
}

export type StorageType = 'picgo' | 'local';
export type StaticType = 'img' | 'customPage';
export interface LoginSetting {
  enableMaxLoginRetry: boolean;
  maxRetryTimes: number;
  durationSeconds: number;
  expiresIn: number;
}

export const defaultLoginSetting: LoginSetting = {
  enableMaxLoginRetry: true,
  maxRetryTimes: 5,
  durationSeconds: 15 * 60,
  expiresIn: 3600 * 24 * 7,
};

export interface VersionSetting {
  version: string;
}

// export interface ScriptItem {
//   type: 'code' | 'link';
//   value: string;
// }

export interface LayoutSetting {
  script: string;
  html: string;
  css: string;
  head: string;
}

export interface HeadTag {
  name: string;
  props: Record<string, string>;
  conent: string;
}

export interface HttpsSetting {
  redirect: boolean;
}
export interface SearchStaticOption {
  staticType: StaticType;
  page: number;
  pageSize: number;
  view: 'admin' | 'public';
}
export const StoragePath: Record<StaticType, string> = {
  img: `img`,
  customPage: `customPage`,
};
export class StaticSetting {
  storageType: StorageType;
  picgoConfig: any;
  picgoPlugins: string;
  enableWaterMark: boolean;
  waterMarkText: string;
  enableWebp: boolean;
}
