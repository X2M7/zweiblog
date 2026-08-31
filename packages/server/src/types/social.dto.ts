import { BadRequestException } from '@nestjs/common';

export const SOCIAL_TYPE_MAX_LENGTH = 64;
export const SOCIAL_VALUE_MAX_LENGTH = 2048;

export type SocialValueKind = 'external' | 'email' | 'phone' | 'sms' | 'qr';

const option = <Value extends string, Kind extends SocialValueKind = 'external'>(
  category: string,
  name: string,
  value: Value,
  kind?: Kind,
) => ({
  label: `[${category}] ${name}`,
  value,
  kind: (kind || 'external') as Kind,
});

/** The single source of truth for supported contact types and admin options. */
export const SOCIAL_TYPE_OPTIONS = [
  option('通用', '网站', 'website'),
  option('通用', '邮箱', 'email', 'email'),
  option('通用', '电话', 'phone', 'phone'),
  option('通用', '短信', 'sms', 'sms'),
  option('通用', '地址', 'address'),
  option('通用', 'RSS', 'rss'),
  option('通用', 'Linktree', 'linktree'),
  option('通用', '自定义链接', 'custom'),

  option('国内平台', '微信', 'wechat', 'qr'),
  option('国内平台', '微信（深色二维码）', 'wechat-dark', 'qr'),
  option('国内平台', '微信公众号', 'wechat-official', 'qr'),
  option('国内平台', '微信视频号', 'wechat-channels', 'qr'),
  option('国内平台', '企业微信', 'wecom', 'qr'),
  option('国内平台', 'QQ', 'qq'),
  option('国内平台', 'QQ 群', 'qq-group'),
  option('国内平台', '微博', 'weibo'),
  option('国内平台', '哔哩哔哩', 'bilibili'),
  option('国内平台', '抖音', 'douyin'),
  option('国内平台', '快手', 'kuaishou'),
  option('国内平台', '小红书', 'xiaohongshu'),
  option('国内平台', '知乎', 'zhihu'),
  option('国内平台', '豆瓣', 'douban'),
  option('国内平台', '掘金', 'juejin'),
  option('国内平台', 'CSDN', 'csdn'),
  option('国内平台', 'SegmentFault', 'segmentfault'),
  option('国内平台', 'AcFun', 'acfun'),
  option('国内平台', '百度贴吧', 'baidu-tieba'),
  option('国内平台', '酷安', 'coolapk'),
  option('国内平台', '网易云音乐', 'netease-music'),
  option('国内平台', '飞书', 'feishu'),
  option('国内平台', '钉钉', 'dingtalk'),
  option('国内平台', '语雀', 'yuque'),
  option('国内平台', 'V2EX', 'v2ex'),
  option('国内平台', '开源中国', 'oschina'),
  option('国内平台', '博客园', 'cnblogs'),
  option('国内平台', 'Gitee', 'gitee'),
  option('国内平台', 'CODING', 'coding'),

  option('开发平台', 'GitHub', 'github'),
  option('开发平台', 'GitLab', 'gitlab'),
  option('开发平台', 'Bitbucket', 'bitbucket'),
  option('开发平台', 'Codeberg', 'codeberg'),
  option('开发平台', 'Stack Overflow', 'stackoverflow'),
  option('开发平台', 'Stack Exchange', 'stackexchange'),
  option('开发平台', 'LeetCode', 'leetcode'),
  option('开发平台', 'Codeforces', 'codeforces'),
  option('开发平台', 'HackerRank', 'hackerrank'),
  option('开发平台', 'Kaggle', 'kaggle'),
  option('开发平台', 'Hugging Face', 'huggingface'),
  option('开发平台', 'DEV Community', 'devto'),
  option('开发平台', 'Hashnode', 'hashnode'),
  option('开发平台', 'CodePen', 'codepen'),
  option('开发平台', 'CodeSandbox', 'codesandbox'),
  option('开发平台', 'Docker Hub', 'dockerhub'),

  option('海外社交', 'X', 'x'),
  option('海外社交', 'Twitter', 'twitter'),
  option('海外社交', 'Facebook', 'facebook'),
  option('海外社交', 'Instagram', 'instagram'),
  option('海外社交', 'Threads', 'threads'),
  option('海外社交', 'Bluesky', 'bluesky'),
  option('海外社交', 'Mastodon', 'mastodon'),
  option('海外社交', 'LinkedIn', 'linkedin'),
  option('海外社交', 'YouTube', 'youtube'),
  option('海外社交', 'TikTok', 'tiktok'),
  option('海外社交', 'Twitch', 'twitch'),
  option('海外社交', 'Vimeo', 'vimeo'),
  option('海外社交', 'Reddit', 'reddit'),
  option('海外社交', 'Pinterest', 'pinterest'),
  option('海外社交', 'Tumblr', 'tumblr'),
  option('海外社交', 'Snapchat', 'snapchat'),
  option('海外社交', 'Quora', 'quora'),
  option('海外社交', 'Medium', 'medium'),
  option('海外社交', 'Substack', 'substack'),
  option('海外社交', 'WordPress', 'wordpress'),
  option('海外社交', 'Blogger', 'blogger'),

  option('即时通讯', 'Telegram', 'telegram'),
  option('即时通讯', 'Discord', 'discord'),
  option('即时通讯', 'WhatsApp', 'whatsapp'),
  option('即时通讯', 'Signal', 'signal'),
  option('即时通讯', 'LINE', 'line'),
  option('即时通讯', 'KakaoTalk', 'kakaotalk'),
  option('即时通讯', 'Viber', 'viber'),
  option('即时通讯', 'Skype', 'skype'),
  option('即时通讯', 'Messenger', 'messenger'),
  option('即时通讯', 'Matrix', 'matrix'),
  option('即时通讯', 'Slack', 'slack'),
  option('即时通讯', 'Microsoft Teams', 'microsoft-teams'),
  option('即时通讯', 'Zoom', 'zoom'),
  option('即时通讯', 'Keybase', 'keybase'),
  option('即时通讯', 'IRC', 'irc'),
  option('即时通讯', 'XMPP', 'xmpp'),

  option('音乐与游戏', 'Spotify', 'spotify'),
  option('音乐与游戏', 'Apple Music', 'apple-music'),
  option('音乐与游戏', 'SoundCloud', 'soundcloud'),
  option('音乐与游戏', 'Bandcamp', 'bandcamp'),
  option('音乐与游戏', 'Steam', 'steam'),
  option('音乐与游戏', 'Epic Games', 'epic-games'),
  option('音乐与游戏', 'PlayStation', 'playstation'),
  option('音乐与游戏', 'Xbox', 'xbox'),

  option('创作与研究', 'Dribbble', 'dribbble'),
  option('创作与研究', 'Behance', 'behance'),
  option('创作与研究', 'Figma', 'figma'),
  option('创作与研究', 'Patreon', 'patreon'),
  option('创作与研究', 'Ko-fi', 'ko-fi'),
  option('创作与研究', 'Buy Me a Coffee', 'buy-me-a-coffee'),
  option('创作与研究', 'ORCID', 'orcid'),
  option('创作与研究', 'ResearchGate', 'researchgate'),
  option('创作与研究', 'Google Scholar', 'google-scholar'),
] as const;

export type SocialType = (typeof SOCIAL_TYPE_OPTIONS)[number]['value'];

export const SOCIAL_TYPE_ALLOWLIST: ReadonlySet<string> = new Set(
  SOCIAL_TYPE_OPTIONS.map(({ value }) => value),
);

const SOCIAL_KIND_BY_TYPE = new Map<string, SocialValueKind>(
  SOCIAL_TYPE_OPTIONS.map(({ value, kind }) => [value, kind]),
);

export function getSocialValueKind(type: unknown): SocialValueKind | undefined {
  return typeof type === 'string' ? SOCIAL_KIND_BY_TYPE.get(type) : undefined;
}

const DANGEROUS_SCHEME = /^(?:javascript|data|vbscript|file):/i;
const EMAIL_PATTERN =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const PHONE_PATTERN = /^\+?[0-9][0-9\s().-]*$/;

export class SocialItem {
  updatedAt: Date;
  value: string;
  type: SocialType;
}
export class SocialDto {
  value: string;
  type: SocialType;
}

export function normalizeSocialTypeKey(type: unknown): string {
  if (typeof type !== 'string') {
    throw new BadRequestException('Social type must be a string');
  }
  const normalized = type.trim();
  if (
    !normalized ||
    normalized.length > SOCIAL_TYPE_MAX_LENGTH ||
    !/^[a-z0-9][a-z0-9-]*$/.test(normalized)
  ) {
    throw new BadRequestException(
      `Social type must be a safe key containing 1-${SOCIAL_TYPE_MAX_LENGTH} characters`,
    );
  }
  return normalized;
}

export function assertSocialType(type: unknown): SocialType {
  const normalized = normalizeSocialTypeKey(type);
  if (!SOCIAL_TYPE_ALLOWLIST.has(normalized)) {
    throw new BadRequestException(`Unsupported social type: ${normalized}`);
  }
  return normalized as SocialType;
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isLocalPath(value: string) {
  return (
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.includes('\\') &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function stripScheme(value: string, scheme: 'mailto' | 'tel' | 'sms') {
  const prefix = `${scheme}:`;
  return value.toLowerCase().startsWith(prefix) ? value.slice(prefix.length) : value;
}

function isPhoneValue(value: string, scheme: 'tel' | 'sms') {
  const number = stripScheme(value, scheme);
  if (!PHONE_PATTERN.test(number)) return false;
  const digitCount = number.replace(/\D/g, '').length;
  return digitCount >= 3 && digitCount <= 20;
}

export function normalizeSocialDto(input: unknown): SocialDto {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new BadRequestException('Social contact must be an object');
  }
  const raw = input as Record<string, unknown>;
  const type = assertSocialType(raw.type);
  if (typeof raw.value !== 'string') {
    throw new BadRequestException('Social value must be a string');
  }
  const value = raw.value.trim();
  if (!value || value.length > SOCIAL_VALUE_MAX_LENGTH) {
    throw new BadRequestException(
      `Social value must contain 1-${SOCIAL_VALUE_MAX_LENGTH} characters`,
    );
  }

  const hasControlCharacters = /[\u0000-\u001f\u007f]/.test(value);
  const compactValue = value.replace(/[\u0000-\u0020\u007f]+/g, '');
  if (hasControlCharacters || DANGEROUS_SCHEME.test(compactValue)) {
    throw new BadRequestException('Unsafe social value scheme');
  }

  const kind = getSocialValueKind(type);
  if (kind === 'email') {
    const email = stripScheme(value, 'mailto');
    if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
      throw new BadRequestException('Social email must be a valid email address');
    }
  } else if (kind === 'phone') {
    if (!isPhoneValue(value, 'tel')) {
      throw new BadRequestException('Social phone must be a valid phone number or tel: value');
    }
  } else if (kind === 'sms') {
    if (!isPhoneValue(value, 'sms')) {
      throw new BadRequestException('Social SMS must be a valid phone number or sms: value');
    }
  } else if (kind === 'qr') {
    if (!isLocalPath(value) && !isHttpUrl(value)) {
      throw new BadRequestException('Social QR value must be a local path or HTTP(S) URL');
    }
  } else if (!isHttpUrl(value)) {
    throw new BadRequestException('Social link must be an HTTP(S) URL');
  }

  return { type, value };
}
