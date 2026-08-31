import DOMPurify from 'isomorphic-dompurify';

import type { HeadTag } from '../../utils/getLayoutProps';

const SAFE_URI_PATTERN = /^(?:(?:https?|mailto|tel):|(?:[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$)))/i;
const FORBIDDEN_HTML_TAGS = ['base', 'embed', 'iframe', 'object', 'script'];
const ALLOWED_LINK_REL = new Set([
  'alternate',
  'apple-touch-icon',
  'canonical',
  'dns-prefetch',
  'icon',
  'manifest',
  'modulepreload',
  'preconnect',
  'preload',
  'stylesheet',
]);
const ALLOWED_CROSS_ORIGIN = new Set(['anonymous', 'use-credentials']);
const ALLOWED_REFERRER_POLICY = new Set([
  'no-referrer',
  'no-referrer-when-downgrade',
  'origin',
  'origin-when-cross-origin',
  'same-origin',
  'strict-origin',
  'strict-origin-when-cross-origin',
  'unsafe-url',
]);
const ALLOWED_AS = new Set(['fetch', 'font', 'image', 'style']);

type SafeHeadTag = {
  name: 'link' | 'meta' | 'title';
  props: Record<string, string>;
  content?: string;
};

function toStringValue(value: unknown): string | undefined {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return undefined;
}

function normalizeAttributeName(name: string): string {
  return name.toLowerCase().replace(/[-_]/g, '');
}

function isSafeWebUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || /[\u0000-\u001f\u007f]/.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed, 'https://zweiblog.invalid/');
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function sanitizeCustomHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_URI_REGEXP: SAFE_URI_PATTERN,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    FORBID_ATTR: ['srcdoc'],
    FORBID_TAGS: FORBIDDEN_HTML_TAGS,
    RETURN_TRUSTED_TYPE: false,
    USE_PROFILES: { html: true },
  }) as string;
}

function sanitizeMeta(tag: HeadTag): SafeHeadTag | null {
  const props: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(tag.props || {})) {
    const name = normalizeAttributeName(rawName);
    const value = toStringValue(rawValue);
    if (value === undefined) continue;
    if (name === 'name' || name === 'property' || name === 'content') {
      props[name] = value;
    } else if (name === 'charset' && value.trim().toLowerCase() === 'utf-8') {
      props.charSet = 'utf-8';
    }
    // `http-equiv` is intentionally never copied, which also forbids refresh.
  }
  if (!props.name && !props.property && !props.charSet) return null;
  return { name: 'meta', props };
}

function sanitizeLink(tag: HeadTag): SafeHeadTag | null {
  const rawProps = tag.props || {};
  const values = new Map<string, string>();
  for (const [rawName, rawValue] of Object.entries(rawProps)) {
    const value = toStringValue(rawValue);
    if (value !== undefined) values.set(normalizeAttributeName(rawName), value.trim());
  }

  const rel = (values.get('rel') || '')
    .toLowerCase()
    .split(/\s+/)
    .filter((value) => ALLOWED_LINK_REL.has(value));
  const href = values.get('href') || '';
  if (rel.length === 0 || !isSafeWebUrl(href)) return null;

  const props: Record<string, string> = { rel: Array.from(new Set(rel)).join(' '), href };
  for (const name of ['hrefLang', 'media', 'sizes', 'title', 'type'] as const) {
    const value = values.get(name.toLowerCase());
    if (value) props[name] = value;
  }
  const as = (values.get('as') || '').toLowerCase();
  if (ALLOWED_AS.has(as)) props.as = as;
  const crossOrigin = (values.get('crossorigin') || '').toLowerCase();
  if (ALLOWED_CROSS_ORIGIN.has(crossOrigin)) props.crossOrigin = crossOrigin;
  const integrity = values.get('integrity');
  if (integrity) props.integrity = integrity;
  const referrerPolicy = (values.get('referrerpolicy') || '').toLowerCase();
  if (ALLOWED_REFERRER_POLICY.has(referrerPolicy)) props.referrerPolicy = referrerPolicy;

  return { name: 'link', props };
}

function sanitizeTitle(tag: HeadTag): SafeHeadTag | null {
  const content = toStringValue(tag.content)?.trim();
  if (!content) return null;
  return { name: 'title', props: {}, content };
}

export function sanitizeCustomHead(tags?: HeadTag[]): SafeHeadTag[] {
  if (!Array.isArray(tags)) return [];
  return tags.flatMap((tag) => {
    const name = String(tag?.name || '').toLowerCase();
    const sanitized =
      name === 'meta'
        ? sanitizeMeta(tag)
        : name === 'link'
          ? sanitizeLink(tag)
          : name === 'title'
            ? sanitizeTitle(tag)
            : null;
    return sanitized ? [sanitized] : [];
  });
}

export function isTrustedCustomCodeEnabled(value: unknown): boolean {
  return value === true || value === 'true';
}
