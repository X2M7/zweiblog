import { parseBoundedInteger, parseOptionalQueryString, parseQueryBoolean } from './query';

describe('query parsers', () => {
  it('does not treat the string false as truthy', () => {
    expect(parseQueryBoolean('false', true)).toBe(false);
    expect(parseQueryBoolean('true')).toBe(true);
  });

  it('requires an entire bounded integer', () => {
    expect(parseBoundedInteger('10', 1, 1, 100)).toBe(10);
    expect(() => parseBoundedInteger('10junk', 1, 1, 100)).toThrow();
    expect(() => parseBoundedInteger('101', 1, 1, 100)).toThrow();
  });

  it('rejects structured and oversized string query values', () => {
    expect(parseOptionalQueryString('news', 10)).toBe('news');
    expect(() => parseOptionalQueryString({ $ne: '' }, 10)).toThrow();
    expect(() => parseOptionalQueryString('too-long-value', 5)).toThrow();
  });
});
