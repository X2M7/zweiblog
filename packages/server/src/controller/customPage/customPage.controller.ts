import { Controller, Get, HttpException, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import * as path from 'node:path';
import { config } from 'src/config';
import { CustomPageProvider } from 'src/provider/customPage/customPage.provider';
import { normalizeManagedPath, resolvePathWithinRoot } from 'src/utils/safePath';
import {
  CUSTOM_PAGE_MAX_PATH_BYTES,
  CUSTOM_PAGE_MAX_PATH_SEGMENTS,
  getDirectoryRedirectLocation,
  resolveCustomPageFileRequest,
} from './customPageRouting';
import { setCustomPageSecurityHeaders } from './customPageSecurity';

@ApiTags('c')
@Controller('c')
export class PublicCustomPageController {
  constructor(private readonly customPageProvider: CustomPageProvider) {}

  @Get('/*pathname')
  async getPageContent(@Res() res: Response, @Req() req: Request) {
    let requestPath: string;
    try {
      requestPath = decodeURIComponent(req.path.replace(/^\/c\/?/, ''));
    } catch {
      throw new HttpException('Invalid path', 400);
    }

    if (!requestPath) {
      throw new HttpException('Not found', 404);
    }
    if (Buffer.byteLength(requestPath, 'utf8') > CUSTOM_PAGE_MAX_PATH_BYTES) {
      throw new HttpException('Invalid path', 400);
    }

    const customPageRoot = path.join(config.staticPath, 'customPage');
    // Perform containment validation before using the path for DB or file lookups.
    resolvePathWithinRoot(customPageRoot, requestPath);
    const requestSegments = requestPath.replace(/\\/g, '/').split('/').filter(Boolean);
    if (requestSegments.length > CUSTOM_PAGE_MAX_PATH_SEGMENTS) {
      throw new HttpException('Invalid path', 400);
    }

    let currentPage = null;
    let pageSegmentCount = 0;
    for (let i = requestSegments.length; i > 0; i -= 1) {
      const candidate = normalizeManagedPath(requestSegments.slice(0, i).join('/'));
      currentPage = await this.customPageProvider.getCustomPageByPath(candidate);
      if (currentPage) {
        pageSegmentCount = i;
        break;
      }
    }

    if (!currentPage) {
      throw new HttpException('Not found', 404);
    }

    setCustomPageSecurityHeaders(res, currentPage.sandboxMode);
    const remainingSegments = requestSegments.slice(pageSegmentCount);

    if (currentPage.type === 'file') {
      if (!currentPage.html || remainingSegments.length) {
        throw new HttpException('Not found', 404);
      }
      res.status(200).type('html').send(currentPage.html);
      return;
    }

    if (currentPage.type === 'folder') {
      const pageRoot = resolvePathWithinRoot(customPageRoot, currentPage.path);
      // The response varies only when a missing extensionless path is eligible
      // for the HTML SPA fallback. Declaring it for all project files also
      // prevents a cached 404 from hiding a later browser navigation response.
      res.vary('Accept');
      const resolution = resolveCustomPageFileRequest({
        pageRoot,
        remainingSegments,
        requestHasTrailingSlash: req.path.endsWith('/'),
        acceptHeader: req.headers.accept,
      });

      if (resolution.kind === 'directory-redirect') {
        res.redirect(302, getDirectoryRedirectLocation(req.path, req.originalUrl));
        return;
      }
      if (resolution.kind === 'not-found') {
        throw new HttpException('Not found', 404);
      }

      // Express derives MIME from the requested file and implements RFC range
      // responses. Keeping range support explicit is important for local PDFs,
      // video and audio embedded in custom pages.
      res.sendFile(resolution.absolutePath, { acceptRanges: true, dotfiles: 'ignore' });
      return;
    }

    throw new HttpException('Not found', 404);
  }
}

@Controller('custom')
export class PublicOldCustomPageRedirectController {
  @Get('/*pathname')
  async redirect(@Res() res: Response, @Req() req: Request) {
    const newUrl = req.url.replace('/custom/', '/c/');
    res.redirect(301, newUrl);
  }
}
