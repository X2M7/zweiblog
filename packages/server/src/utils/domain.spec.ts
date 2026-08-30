import { domainFromUrl, normalizeDomain } from './domain';

describe('domain allowlist normalization', () => {
  it('normalizes case, trailing dots and IDNs', () => {
    expect(normalizeDomain('Example.COM.')).toBe('example.com');
    expect(normalizeDomain('例子.测试')).toBe('xn--fsqu00a.xn--0zwm56d');
  });

  it('rejects IPs, ports and malformed hostnames', () => {
    expect(normalizeDomain('127.0.0.1')).toBeNull();
    expect(normalizeDomain('example.com:443')).toBeNull();
    expect(normalizeDomain('-bad.example')).toBeNull();
  });

  it('extracts only HTTP(S) URL hostnames', () => {
    expect(domainFromUrl('https://Blog.Example.com/path')).toBe('blog.example.com');
    expect(domainFromUrl('ftp://example.com/file')).toBeNull();
  });
});
