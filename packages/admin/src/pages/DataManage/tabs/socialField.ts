export const SOCIAL_VALUE_MAX_LENGTH = 2048;

const QR_CODE_TYPES = new Set([
  'wechat',
  'wechat-dark',
  'wechat-official',
  'wechat-channels',
  'wecom',
]);

const DIRECT_VALUE_TYPES = new Set(['email', 'phone', 'sms']);

export type SocialValueKind = 'direct' | 'external' | 'qr-code';

export type SocialTypeOption = {
  label: string;
  value: string;
};

export type SocialValueGuidance = {
  kind: SocialValueKind;
  placeholder: string;
  help: string;
};

export function normalizeSocialTypeOptions(options: unknown): SocialTypeOption[] {
  if (!Array.isArray(options)) return [];

  const seen = new Set<string>();
  const normalized: SocialTypeOption[] = [];

  options.forEach((option) => {
    const optionRecord =
      option && typeof option === 'object' ? (option as Record<string, unknown>) : undefined;
    const value =
      typeof option === 'string'
        ? option
        : typeof optionRecord?.value === 'string'
        ? optionRecord.value
        : '';
    if (!value || seen.has(value)) return;

    const rawLabel = typeof optionRecord?.label === 'string' ? optionRecord.label.trim() : '';
    normalized.push({ value, label: rawLabel || value });
    seen.add(value);
  });

  return normalized;
}

export function getSocialTypeLabel(options: SocialTypeOption[], type: unknown): string {
  const value = typeof type === 'string' ? type : '';
  return options.find((option) => option.value === value)?.label || value;
}

export function filterSocialTypeOption(input: string, option?: Record<string, unknown>): boolean {
  const query = input.trim().toLocaleLowerCase();
  if (!query) return true;

  const label = String(option?.label ?? option?.children ?? '').toLocaleLowerCase();
  const value = String(option?.value ?? '').toLocaleLowerCase();
  return label.includes(query) || value.includes(query);
}

export function getSocialValueKind(type: unknown): SocialValueKind {
  if (typeof type === 'string' && QR_CODE_TYPES.has(type)) return 'qr-code';
  if (typeof type === 'string' && DIRECT_VALUE_TYPES.has(type)) return 'direct';
  return 'external';
}

export function getSocialValueGuidance(type: unknown): SocialValueGuidance {
  if (type === 'email') {
    return {
      kind: 'direct',
      placeholder: '例如：name@example.com',
      help: '请直接填写邮箱地址。',
    };
  }
  if (type === 'phone') {
    return {
      kind: 'direct',
      placeholder: '例如：+86 13800138000',
      help: '请直接填写电话号码。',
    };
  }
  if (type === 'sms') {
    return {
      kind: 'direct',
      placeholder: '例如：+86 13800138000',
      help: '请直接填写接收短信的号码。',
    };
  }
  if (getSocialValueKind(type) === 'qr-code') {
    return {
      kind: 'qr-code',
      placeholder: '例如：/static/qrcode.png 或 https://example.com/qrcode.png',
      help: '请填写二维码图片的站内路径或完整 http(s) 地址。',
    };
  }
  return {
    kind: 'external',
    placeholder: '例如：https://example.com/username',
    help: '',
  };
}
