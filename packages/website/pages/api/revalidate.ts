import { isRequestRenderedArticlePath } from "../../utils/requestPageProps";
import { createHash, timingSafeEqual } from 'node:crypto';

const staticPaths = new Set(['/about', '/en/about', '/link', '/en/link', '/tag', '/en/tag']);

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ message: 'Method not allowed' });
  }
  const expected = process.env.ZWEI_BLOG_REVALIDATE_SECRET?.trim();
  const supplied = req.headers?.['x-zweiblog-revalidate-secret'];
  if (
    !expected || typeof supplied !== 'string' || !supplied || supplied.length > 1024 ||
    !timingSafeEqual(
      createHash('sha256').update(supplied).digest(),
      createHash('sha256').update(expected).digest(),
    )
  ) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const path = req.query?.path;
  if (typeof path !== 'string' || path.length > 1024) {
    return res.status(400).json({ message: 'Invalid revalidation path' });
  }
  if (isRequestRenderedArticlePath(path)) {
    // These pages have no ISR entry. Old backend versions may still ask to
    // revalidate them; acknowledge without invoking Next's SSG-only API.
    return res.json({ revalidated: false, requestRendered: true });
  }
  if (!staticPaths.has(path)) {
    return res.status(400).json({ message: 'Invalid revalidation path' });
  }
  try {
    await res.revalidate(path);
    return res.json({ revalidated: true });
  } catch (err) {
    // If there was an error, Next.js will continue
    // to show the last successfully generated page
    console.log(err);
    return res.status(500).send("触发增量增量渲染失败");
  }
}
