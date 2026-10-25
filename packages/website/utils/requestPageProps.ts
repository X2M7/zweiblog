import type { GetServerSidePropsContext } from 'next';
import type { ArticleLanguage } from './articleLanguage';
import { getArticlePath } from './getArticlePath';
import { getPostPagesProps } from './getPageProps';

/** Apply to HTML and Next's JSON data responses, including redirects and 404s. */
export function preventPageCaching(response: Pick<GetServerSidePropsContext['res'], 'setHeader'>) {
  response.setHeader('Cache-Control', 'private, no-store, no-cache, max-age=0, must-revalidate');
  // The Pages Router has a separate middleware/prefetch data cache. HTTP
  // Cache-Control alone does not evict that in-memory cache.
  response.setHeader('x-middleware-cache', 'no-cache');
}

/** Pages containing article bodies, summaries, or hidden article titles. */
export function isRequestRenderedArticlePath(path: string): boolean {
  return (
    /^(?:\/|\/en\/?)$/.test(path) ||
    /^(?:\/en)?\/(?:post\/[^/?#]+|page\/[^/?#]+|category(?:\/[^/?#]+)?|tag\/[^/?#]+|timeline)\/?$/.test(
      path,
    )
  );
}

export async function getArticleServerSideProps(
  context: GetServerSidePropsContext,
  language: ArticleLanguage = 'zh',
) {
  preventPageCaching(context.res);
  const id = context.params?.id;
  if (typeof id !== 'string' || !id) return { notFound: true as const };

  // Always consult the public API again. Privacy changes must not depend on
  // ISR mode, successful background revalidation, or remembered old aliases.
  const props = await getPostPagesProps(id);
  if (!props.article) return { notFound: true as const };

  const canonicalId = getArticlePath(props.article);
  if (id !== canonicalId) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(context.query)) {
      if (key === 'id' || key.startsWith('__next')) continue;
      for (const item of Array.isArray(value) ? value : [value]) {
        if (item !== undefined) query.append(key, item);
      }
    }
    if (language === 'en') query.set('lang', 'en');
    const suffix = query.toString();
    return {
      redirect: {
        destination: `/post/${encodeURIComponent(canonicalId)}${suffix ? `?${suffix}` : ''}`,
        // Slugs and visibility can change again, so do not cache this redirect.
        permanent: false as const,
      },
    };
  }

  return { props: { ...props, initialLanguage: language } };
}
