import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import * as path from 'node:path';

/** Keep custom pages and upload staging outside every generic static root. */
export function registerPublicStaticAssets(app: NestExpressApplication, staticRoot: string) {
  app.use('/static/customPage', (req: Request, res: Response) => {
    // Express has removed the mount prefix from req.url, preserving the query.
    // The final /c response applies the page's configured CSP sandbox.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.redirect(308, `/c${req.url}`);
  });

  // A deny-list middleware cannot guard express.static(staticRoot): the URL
  // router and the filesystem server decode paths at different stages.
  // Mount only public subdirectories so encoded names or traversal cannot
  // reach sibling customPage, tmp or upload-staging directories.
  // Historical image-export ZIPs must also become inaccessible on upgrade.
  for (const directory of ['img', 'rss', 'sitemap']) {
    app.useStaticAssets(path.join(staticRoot, directory), {
      prefix: `/static/${directory}/`,
      dotfiles: 'ignore',
    });
  }
}
