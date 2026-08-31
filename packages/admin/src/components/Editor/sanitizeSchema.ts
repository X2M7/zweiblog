type AttributeRule = string | [string, ...unknown[]] | RegExp;

export type MarkdownSanitizeSchema = {
  attributes?: Record<string, AttributeRule[]>;
  protocols?: Record<string, string[]>;
  required?: Record<string, Record<string, unknown>>;
  strip?: string[];
  tagNames?: string[];
  [key: string]: unknown;
};

type SanitizedMarkdownSchema<T extends MarkdownSanitizeSchema> = T & {
  attributes: Record<string, AttributeRule[]>;
  protocols: Record<string, string[]>;
  required: Record<string, Record<string, unknown>>;
  strip: string[];
  tagNames: string[];
};

const FORBIDDEN_TAGS = new Set(['base', 'embed', 'object', 'script']);
const FORBIDDEN_PROTOCOLS = new Set(['data', 'javascript', 'vbscript']);
const SAFE_CUSTOM_PAGE_IFRAME_SRC =
  /^\/c\/(?!\.{1,2}(?:\/|[?#]|$))[^/\\?#\s<>"'`%]+(?:\/(?!\.{1,2}(?:\/|[?#]|$))[^/\\?#\s<>"'`%]+)*\/?(?:\?(?:[^#\\\s<>"'`%]|%[0-9a-f]{2})*)?(?:#(?:[^\\\s<>"'`%]|%[0-9a-f]{2})*)?$/i;
const SAFE_IFRAME_STYLE =
  /^(?:\s*(?:(?:display\s*:\s*(?:block|inline-block))|(?:(?:width|min-width|max-width|height|min-height|max-height)\s*:\s*(?:0|\d+(?:\.\d+)?(?:px|%|rem|em|vw|vh)))|(?:border\s*:\s*(?:0|none))|(?:border-radius\s*:\s*(?:0|\d+(?:\.\d+)?(?:px|%|rem|em)))|(?:overflow(?:-x|-y)?\s*:\s*(?:auto|hidden|scroll|visible)))\s*;?)+$/i;

const SAFE_IFRAME_ATTRIBUTES: AttributeRule[] = [
  ['src', SAFE_CUSTOM_PAGE_IFRAME_SRC],
  ['style', SAFE_IFRAME_STYLE],
  ['loading', 'lazy', 'eager'],
  ['scrolling', 'yes', 'no', 'auto'],
  ['frameBorder', '0'],
  ['allowFullScreen', true],
];

const REQUIRED_IFRAME_ATTRIBUTES = {
  sandbox: ['allow-scripts', 'allow-forms', 'allow-modals', 'allow-popups', 'allow-downloads'],
  loading: 'lazy',
  referrerPolicy: 'same-origin',
  allow: 'clipboard-write',
};

/** Reapply the iframe policy after ByteMD's plugin transforms. */
export function sanitizeCustomPageIframeProperties(
  properties?: Record<string, unknown>,
): Record<string, unknown> | null {
  const src = properties?.src;
  if (typeof src !== 'string' || !SAFE_CUSTOM_PAGE_IFRAME_SRC.test(src)) return null;

  const sanitized: Record<string, unknown> = {
    src,
    sandbox: [...REQUIRED_IFRAME_ATTRIBUTES.sandbox],
    loading: REQUIRED_IFRAME_ATTRIBUTES.loading,
    referrerPolicy: REQUIRED_IFRAME_ATTRIBUTES.referrerPolicy,
    allow: REQUIRED_IFRAME_ATTRIBUTES.allow,
  };
  if (typeof properties?.style === 'string' && SAFE_IFRAME_STYLE.test(properties.style)) {
    sanitized.style = properties.style;
  }
  if (
    typeof properties?.scrolling === 'string' &&
    ['yes', 'no', 'auto'].includes(properties.scrolling.toLowerCase())
  ) {
    sanitized.scrolling = properties.scrolling.toLowerCase();
  }
  if (properties?.frameBorder === '0' || properties?.frameBorder === 0) {
    sanitized.frameBorder = '0';
  }
  if (properties?.allowFullScreen === true) sanitized.allowFullScreen = true;
  return sanitized;
}

function getAttributeName(rule: AttributeRule): string {
  if (typeof rule === 'string') return rule;
  if (Array.isArray(rule) && typeof rule[0] === 'string') return rule[0];
  return '';
}

/** Keep ByteMD's default allowlist plus legacy `center` and safe `/c` embeds. */
export function sanitizeMarkdownSchema<T extends MarkdownSanitizeSchema>(
  schema: T,
): SanitizedMarkdownSchema<T> {
  const globalAttributes = (schema.attributes?.['*'] || []).filter((rule) => {
    const name = getAttributeName(rule).toLowerCase();
    return name !== 'src' && name !== 'srcdoc' && name !== 'style' && !name.startsWith('on');
  });
  const attributes = {
    ...(schema.attributes || {}),
    '*': globalAttributes,
    iframe: SAFE_IFRAME_ATTRIBUTES,
  };
  const protocols = Object.fromEntries(
    Object.entries(schema.protocols || {}).map(([property, values]) => [
      property,
      values.filter((value) => !FORBIDDEN_PROTOCOLS.has(value.toLowerCase())),
    ]),
  );
  const tagNames = Array.from(
    new Set([
      ...(schema.tagNames || []).filter((name) => !FORBIDDEN_TAGS.has(name.toLowerCase())),
      'center',
      'iframe',
    ]),
  );
  const strip = Array.from(new Set([...(schema.strip || []), ...Array.from(FORBIDDEN_TAGS)]));
  const required = {
    ...(schema.required || {}),
    iframe: REQUIRED_IFRAME_ATTRIBUTES,
  };

  return {
    ...schema,
    attributes,
    protocols,
    required,
    strip,
    tagNames,
  } as SanitizedMarkdownSchema<T>;
}
