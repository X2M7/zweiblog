import { describe, expect, it } from 'vitest';
import {
  filterSocialTypeOption,
  getSocialTypeLabel,
  getSocialValueGuidance,
  getSocialValueKind,
  normalizeSocialTypeOptions,
  SOCIAL_VALUE_MAX_LENGTH,
} from './socialField';

describe('social contact field helpers', () => {
  it('normalizes server options, removes duplicates and falls back to the value as label', () => {
    const options = normalizeSocialTypeOptions([
      { label: '[国际] GitHub', value: 'github' },
      { label: '重复项', value: 'github' },
      { label: '  ', value: 'website' },
      'custom',
      null,
      { label: '无值' },
    ]);

    expect(options).toEqual([
      { label: '[国际] GitHub', value: 'github' },
      { label: 'website', value: 'website' },
      { label: 'custom', value: 'custom' },
    ]);
    expect(getSocialTypeLabel(options, 'github')).toBe('[国际] GitHub');
    expect(getSocialTypeLabel(options, 'legacy-type')).toBe('legacy-type');
  });

  it('searches select options by either friendly label or stored value', () => {
    const option = { label: '[国际] GitHub', value: 'github' };

    expect(filterSocialTypeOption('国际', option)).toBe(true);
    expect(filterSocialTypeOption('GITHUB', option)).toBe(true);
    expect(filterSocialTypeOption('微信', option)).toBe(false);
  });

  it('classifies every special value format and defaults other platforms to external URLs', () => {
    ['wechat', 'wechat-dark', 'wechat-official', 'wechat-channels', 'wecom'].forEach((type) => {
      expect(getSocialValueKind(type)).toBe('qr-code');
      expect(getSocialValueGuidance(type).help).toContain('二维码图片');
      expect(getSocialValueGuidance(type).help).toContain('站内路径');
    });

    ['email', 'phone', 'sms'].forEach((type) => {
      expect(getSocialValueKind(type)).toBe('direct');
      expect(getSocialValueGuidance(type).kind).toBe('direct');
    });

    expect(getSocialValueKind('github')).toBe('external');
    expect(getSocialValueGuidance('github').help).toBe('');
  });

  it('uses the same 2048-character value limit as the server', () => {
    expect(SOCIAL_VALUE_MAX_LENGTH).toBe(2048);
  });
});
