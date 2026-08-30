import { escapeRegexLiteral } from './safeRegex';

describe('escapeRegexLiteral', () => {
  it('turns user input into a literal regular-expression fragment', () => {
    expect(escapeRegexLiteral('(a+)+$')).toBe('\\(a\\+\\)\\+\\$');
  });

  it('rejects empty and excessively long searches', () => {
    expect(() => escapeRegexLiteral('')).toThrow('1-100');
    expect(() => escapeRegexLiteral('a'.repeat(101))).toThrow('1-100');
  });
});
