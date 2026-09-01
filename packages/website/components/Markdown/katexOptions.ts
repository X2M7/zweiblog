/**
 * KaTeX supports CJK glyphs through its Unicode fallback, but its default
 * strict mode still reports every CJK character used in math mode through
 * `console.warn`. During SSR those warnings are forwarded by WebsiteProvider
 * as server errors even though the formula rendered successfully.
 *
 * Ignore only that known compatibility notice. Every other KaTeX strict-mode
 * diagnostic keeps the default `warn` behaviour so malformed or suspicious
 * input remains visible to operators.
 */
export function katexStrictMode(errorCode: string): 'ignore' | 'warn' {
  return errorCode === 'unicodeTextInMathMode' ? 'ignore' : 'warn';
}
