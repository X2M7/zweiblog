type AttributeRule = string | [string, ...unknown[]] | RegExp;

export type MarkdownSanitizeSchema = {
  attributes?: Record<string, AttributeRule[]>;
  protocols?: Record<string, string[]>;
  strip?: string[];
  tagNames?: string[];
  [key: string]: unknown;
};

const FORBIDDEN_TAGS = new Set(['base', 'embed', 'iframe', 'object', 'script']);
const FORBIDDEN_PROTOCOLS = new Set(['data', 'javascript', 'vbscript']);

function getAttributeName(rule: AttributeRule): string {
  if (typeof rule === 'string') return rule;
  if (Array.isArray(rule) && typeof rule[0] === 'string') return rule[0];
  return '';
}

/**
 * Keep ByteMD's default allowlist intact and only add the legacy `center` tag.
 * The explicit removals also make this safe during hot reload if an older
 * callback has already mutated ByteMD's shared schema object.
 */
export function sanitizeMarkdownSchema<T extends MarkdownSanitizeSchema>(schema: T): T {
  const globalAttributes = (schema.attributes?.['*'] || []).filter((rule) => {
    const name = getAttributeName(rule).toLowerCase();
    return name !== 'src' && name !== 'srcdoc' && name !== 'style' && !name.startsWith('on');
  });
  const attributes = {
    ...(schema.attributes || {}),
    '*': globalAttributes,
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
    ]),
  );
  const strip = Array.from(new Set([...(schema.strip || []), ...Array.from(FORBIDDEN_TAGS)]));

  return {
    ...schema,
    attributes,
    protocols,
    strip,
    tagNames,
  } as T;
}
