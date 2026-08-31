import type { BytemdPlugin } from 'bytemd';

import { sanitizeCustomPageIframeProperties } from './sanitizeSchema';

type HastNode = {
  type?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

function removeInvalidIframes(node: HastNode) {
  if (!Array.isArray(node.children)) return;
  node.children = node.children.filter((child) => {
    if (child.type !== 'element' || child.tagName !== 'iframe') return true;
    const properties = sanitizeCustomPageIframeProperties(child.properties);
    if (!properties) return false;
    child.properties = properties;
    return true;
  });
  for (const child of node.children) removeInvalidIframes(child);
}

/** Final defense after ByteMD sanitization and all editor preview plugins. */
export function safeCustomPageIframe(): BytemdPlugin {
  return {
    rehype: (processor) =>
      processor.use(() => (tree: HastNode) => {
        removeInvalidIframes(tree);
      }),
  };
}
