import { BytemdPlugin } from 'bytemd';
import { useId } from 'react';
import { visit } from 'unist-util-visit';

/** A detail page has one article body; other renderers need instance isolation. */
export function useHeadingNamespace(articleId?: number): string {
  const instanceId = useId();
  // useId is stable for hydration, but a new client-side route mount receives
  // a different id than a direct SSR visit. Article permalinks must survive
  // both, including a later change to the article's slug.
  return Number.isSafeInteger(articleId) && articleId > 0
    ? `article-${articleId}`
    : `instance-${instanceId}`;
}

function textContent(node: any): string {
  return typeof node.value === 'string'
    ? node.value
    : (node.children || []).map(textContent).join('');
}

const onClickHeading = (event: Event) => {
  const heading = event.currentTarget as HTMLElement;
  if (heading.id) window.location.hash = heading.id;
};

export function Heading(namespace = 'content'): BytemdPlugin {
  const scope = namespace.replace(/[^a-zA-Z0-9_-]/g, '-');
  return {
    rehype: (processor) =>
      processor.use(() => (tree) => {
        let index = 0;
        visit(tree, (node: any) => {
          if (node.type !== 'element' || !/^h[1-6]$/.test(node.tagName)) return;
          node.properties ||= {};
          // Never give user-controlled titles a framework/global DOM identifier.
          // The renderer namespace also separates headings in different cards.
          node.properties.id = `zb-heading-${scope}-${++index}`;
          node.properties['data-id'] = textContent(node);
          node.properties.className = ['markdown-heading', 'cursor-pointer'];
        });
      }),
    viewerEffect: ({ markdownBody }) => {
      const headings = markdownBody.querySelectorAll('.markdown-heading');
      headings.forEach((heading) => heading.addEventListener('click', onClickHeading));
      return () =>
        headings.forEach((heading) => heading.removeEventListener('click', onClickHeading));
    },
  };
}
