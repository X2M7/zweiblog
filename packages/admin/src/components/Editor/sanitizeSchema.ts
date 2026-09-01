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

const SAFE_PRESENTATION_LENGTH = String.raw`(?:0|(?:\d+(?:\.\d+)?|\.\d+)(?:px|%|rem|em|vw|vh|vmin|vmax|ch|ex))`;
const SAFE_PRESENTATION_LENGTH_OR_AUTO = `(?:auto|${SAFE_PRESENTATION_LENGTH})`;
const SAFE_PRESENTATION_BOX = `${SAFE_PRESENTATION_LENGTH_OR_AUTO}(?:\\s+${SAFE_PRESENTATION_LENGTH_OR_AUTO}){0,3}`;
const SAFE_PRESENTATION_RADIUS = `${SAFE_PRESENTATION_LENGTH}(?:\\s+${SAFE_PRESENTATION_LENGTH}){0,3}`;
const SAFE_PRESENTATION_DECLARATION = [
  String.raw`display\s*:\s*(?:block|inline|inline-block|flex|inline-flex|grid)`,
  `(?:width|min-width|max-width|height|min-height|max-height)\\s*:\\s*${SAFE_PRESENTATION_LENGTH_OR_AUTO}`,
  `(?:margin|padding)\\s*:\\s*${SAFE_PRESENTATION_BOX}`,
  `(?:margin|padding)-(?:top|right|bottom|left|inline|inline-start|inline-end|block|block-start|block-end)\\s*:\\s*${SAFE_PRESENTATION_LENGTH_OR_AUTO}`,
  `border-radius\\s*:\\s*${SAFE_PRESENTATION_RADIUS}`,
  String.raw`border(?:-(?:top|right|bottom|left))?\s*:\s*(?:0|none)`,
  String.raw`overflow(?:-x|-y)?\s*:\s*(?:auto|hidden|scroll|visible|clip)`,
  String.raw`text-align\s*:\s*(?:left|right|center|justify|start|end)`,
  String.raw`vertical-align\s*:\s*(?:baseline|top|middle|bottom|text-top|text-bottom)`,
  String.raw`object-fit\s*:\s*(?:contain|cover|fill|none|scale-down)`,
  String.raw`object-position\s*:\s*(?:left|right|top|bottom|center)(?:\s+(?:left|right|top|bottom|center))?`,
  String.raw`float\s*:\s*(?:left|right|none)`,
  String.raw`clear\s*:\s*(?:left|right|both|none)`,
  String.raw`box-sizing\s*:\s*(?:border-box|content-box)`,
  String.raw`white-space\s*:\s*(?:normal|nowrap|pre|pre-wrap|pre-line|break-spaces)`,
  `gap\\s*:\\s*${SAFE_PRESENTATION_LENGTH}(?:\\s+${SAFE_PRESENTATION_LENGTH})?`,
  String.raw`flex-direction\s*:\s*(?:row|row-reverse|column|column-reverse)`,
  String.raw`flex-wrap\s*:\s*(?:nowrap|wrap|wrap-reverse)`,
  String.raw`justify-content\s*:\s*(?:start|end|center|space-between|space-around|space-evenly)`,
  String.raw`align-items\s*:\s*(?:start|end|center|stretch|baseline)`,
  String.raw`aspect-ratio\s*:\s*(?:auto|(?:\d+(?:\.\d+)?|\.\d+)(?:\s*\/\s*(?:\d+(?:\.\d+)?|\.\d+))?)`,
].join('|');
const SAFE_PRESENTATION_STYLE = new RegExp(
  `^\\s*(?:${SAFE_PRESENTATION_DECLARATION})(?:\\s*;\\s*(?:${SAFE_PRESENTATION_DECLARATION}))*\\s*;?\\s*$`,
  'i',
);

const PRESENTATION_STYLE_TAGS = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'div',
  'span',
  'center',
  'img',
  'figure',
  'figcaption',
  'blockquote',
  'pre',
  'code',
  'ol',
  'ul',
  'li',
  'dl',
  'dt',
  'dd',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'caption',
  'details',
  'summary',
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getConfiguredSiteOriginPattern(siteBaseUrl?: string): string | null {
  if (!siteBaseUrl) return null;
  try {
    const url = new URL(siteBaseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      return null;
    }
    const defaultPort = url.protocol === 'https:' ? '443' : '80';
    const portPattern = url.port ? `:${escapeRegExp(url.port)}` : `(?::${defaultPort})?`;
    return `${escapeRegExp(url.protocol)}\\/\\/${escapeRegExp(url.hostname)}${portPattern}`;
  } catch {
    return null;
  }
}

function getSafeAbsoluteIframeSrcPattern(siteBaseUrl?: string): RegExp | null {
  const originPattern = getConfiguredSiteOriginPattern(siteBaseUrl);
  if (!originPattern) return null;
  return new RegExp(`^${originPattern}${SAFE_CUSTOM_PAGE_IFRAME_SRC.source.slice(1)}`, 'i');
}

/** Normalize a configured same-origin custom-page URL to a root-relative URL. */
export function normalizeCustomPageIframeSrc(src: unknown, siteBaseUrl?: string): string | null {
  if (typeof src !== 'string') return null;
  if (SAFE_CUSTOM_PAGE_IFRAME_SRC.test(src)) return src;

  const originPattern = getConfiguredSiteOriginPattern(siteBaseUrl);
  if (!originPattern) return null;
  const match = src.match(
    new RegExp(`^${originPattern}(${SAFE_CUSTOM_PAGE_IFRAME_SRC.source.slice(1)})`, 'i'),
  );
  return match?.[1] || null;
}

function getSafeIframeAttributes(siteBaseUrl?: string): AttributeRule[] {
  const absoluteSrcPattern = getSafeAbsoluteIframeSrcPattern(siteBaseUrl);
  return [
    ['src', SAFE_CUSTOM_PAGE_IFRAME_SRC, ...(absoluteSrcPattern ? [absoluteSrcPattern] : [])],
    ['style', SAFE_IFRAME_STYLE],
    ['loading', 'lazy', 'eager'],
    ['scrolling', 'yes', 'no', 'auto'],
    ['frameBorder', '0'],
    ['allowFullScreen', true],
  ];
}

const REQUIRED_IFRAME_ATTRIBUTES = {
  sandbox: ['allow-scripts', 'allow-forms', 'allow-modals', 'allow-popups', 'allow-downloads'],
  loading: 'lazy',
  referrerPolicy: 'same-origin',
  allow: 'clipboard-write',
};

/** Reapply the iframe policy after ByteMD's plugin transforms. */
export function sanitizeCustomPageIframeProperties(
  properties?: Record<string, unknown>,
  siteBaseUrl?: string,
): Record<string, unknown> | null {
  const src = normalizeCustomPageIframeSrc(properties?.src, siteBaseUrl);
  if (!src) return null;

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

function addSafePresentationStyles(
  attributes: Record<string, AttributeRule[]>,
): Record<string, AttributeRule[]> {
  const safeAttributes = { ...attributes };
  for (const tagName of PRESENTATION_STYLE_TAGS) {
    const existing = (safeAttributes[tagName] || []).filter(
      (rule) => getAttributeName(rule).toLowerCase() !== 'style',
    );
    safeAttributes[tagName] = [...existing, ['style', SAFE_PRESENTATION_STYLE]];
  }
  return safeAttributes;
}

/** Keep ByteMD's default allowlist plus legacy `center` and safe `/c` embeds. */
export function sanitizeMarkdownSchema<T extends MarkdownSanitizeSchema>(
  schema: T,
  siteBaseUrl?: string,
): SanitizedMarkdownSchema<T> {
  const globalAttributes = (schema.attributes?.['*'] || []).filter((rule) => {
    const name = getAttributeName(rule).toLowerCase();
    return name !== 'src' && name !== 'srcdoc' && name !== 'style' && !name.startsWith('on');
  });
  const attributes = addSafePresentationStyles({
    ...(schema.attributes || {}),
    '*': globalAttributes,
    iframe: getSafeIframeAttributes(siteBaseUrl),
  });
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
