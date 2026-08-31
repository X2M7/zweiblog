import { BadRequestException } from '@nestjs/common';
import {
  normalizeSocialDto,
  SOCIAL_TYPE_ALLOWLIST,
  SOCIAL_TYPE_OPTIONS,
  SOCIAL_VALUE_MAX_LENGTH,
} from './social.dto';

const REQUIRED_TYPES = `
website email phone sms address rss linktree custom
wechat wechat-dark wechat-official wechat-channels wecom qq qq-group weibo bilibili
douyin kuaishou xiaohongshu zhihu douban juejin csdn segmentfault acfun baidu-tieba
coolapk netease-music feishu dingtalk yuque v2ex oschina cnblogs gitee coding
github gitlab bitbucket codeberg stackoverflow stackexchange leetcode codeforces hackerrank
kaggle huggingface devto hashnode codepen codesandbox dockerhub
x twitter facebook instagram threads bluesky mastodon linkedin youtube tiktok twitch vimeo
reddit pinterest tumblr snapchat quora medium substack wordpress blogger
telegram discord whatsapp signal line kakaotalk viber skype messenger matrix slack
microsoft-teams zoom keybase irc xmpp
spotify apple-music soundcloud bandcamp steam epic-games playstation xbox
dribbble behance figma patreon ko-fi buy-me-a-coffee orcid researchgate google-scholar
`
  .trim()
  .split(/\s+/);

describe('social contact catalog and validation', () => {
  it('has one categorized option for every required and legacy type', () => {
    const values = SOCIAL_TYPE_OPTIONS.map(({ value }) => value);

    expect(new Set(values).size).toBe(values.length);
    expect([...values].sort()).toEqual([...REQUIRED_TYPES].sort());
    expect(SOCIAL_TYPE_ALLOWLIST.size).toBe(values.length);
    expect(SOCIAL_TYPE_OPTIONS.every(({ label }) => /^\[[^\]]+\] .+/.test(label))).toBe(true);
    expect(values).toEqual(
      expect.arrayContaining(['bilibili', 'email', 'github', 'gitee', 'wechat', 'wechat-dark']),
    );
  });

  it.each([
    [{ type: 'github', value: 'https://github.com/example' }, 'https://github.com/example'],
    [{ type: 'website', value: ' http://example.com ' }, 'http://example.com'],
    [{ type: 'email', value: 'hello@example.com' }, 'hello@example.com'],
    [{ type: 'email', value: 'mailto:hello@example.com' }, 'mailto:hello@example.com'],
    [{ type: 'phone', value: '+86 138-0000-0000' }, '+86 138-0000-0000'],
    [{ type: 'phone', value: 'tel:+1 (202) 555-0100' }, 'tel:+1 (202) 555-0100'],
    [{ type: 'sms', value: '13800000000' }, '13800000000'],
    [{ type: 'sms', value: 'sms:+1-202-555-0100' }, 'sms:+1-202-555-0100'],
    [{ type: 'wechat', value: '/uploads/wechat.png' }, '/uploads/wechat.png'],
    [
      { type: 'wecom', value: 'https://img.example.com/wecom.png' },
      'https://img.example.com/wecom.png',
    ],
  ])('accepts and trims a valid contact %#', (input, expectedValue) => {
    expect(normalizeSocialDto(input)).toEqual({
      type: input.type,
      value: expectedValue,
    });
  });

  it.each([
    ['a non-object body', null],
    ['a non-string type', { type: 1, value: 'https://example.com' }],
    ['an unknown type', { type: 'myspace', value: 'https://example.com' }],
    ['a non-string value', { type: 'github', value: 2 }],
    ['an empty value', { type: 'github', value: ' ' }],
    [
      'an oversized value',
      { type: 'github', value: `https://example.com/${'a'.repeat(SOCIAL_VALUE_MAX_LENGTH)}` },
    ],
    ['a javascript link', { type: 'github', value: 'javascript:alert(1)' }],
    ['an obfuscated javascript link', { type: 'github', value: 'java\nscript:alert(1)' }],
    ['a non-http external link', { type: 'github', value: 'ftp://example.com/profile' }],
    ['a relative external link', { type: 'github', value: '/profile' }],
    ['an invalid email', { type: 'email', value: 'hello-at-example.com' }],
    ['a wrong phone scheme', { type: 'phone', value: 'sms:+8613800000000' }],
    ['a phone without enough digits', { type: 'phone', value: '+1' }],
    ['a non-http QR URL', { type: 'wechat', value: 'data:image/png;base64,AAAA' }],
    ['a protocol-relative QR URL', { type: 'wechat', value: '//example.com/qr.png' }],
    ['a non-root QR path', { type: 'wechat', value: 'uploads/qr.png' }],
  ])('rejects %s', (_, input) => {
    expect(() => normalizeSocialDto(input)).toThrow(BadRequestException);
  });
});
