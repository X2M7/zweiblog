import { Controller, Get, HttpException, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { config } from 'src/config';
import { CustomPageProvider } from 'src/provider/customPage/customPage.provider';
import { normalizeManagedPath, resolvePathWithinRoot } from 'src/utils/safePath';

const CUSTOM_PAGE_SANDBOX_TOKENS = [
  'allow-scripts',
  'allow-forms',
  'allow-modals',
  'allow-popups',
  'allow-popups-to-escape-sandbox',
  'allow-downloads',
];

function getCustomPageCsp(sandboxMode: unknown) {
  const sandboxTokens = [...CUSTOM_PAGE_SANDBOX_TOKENS];
  if (sandboxMode === 'trusted') sandboxTokens.push('allow-same-origin');
  return [
    `sandbox ${sandboxTokens.join(' ')}`,
    "default-src 'self' https: http: data: blob:",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https: http: blob:",
    "style-src 'self' 'unsafe-inline' https: http:",
    "img-src 'self' https: http: data: blob:",
    "connect-src 'self' https: http: wss: ws:",
    "object-src 'none'",
    "base-uri 'self' https: http:",
    "frame-ancestors 'self'",
  ].join('; ');
}

function setCustomPageSecurityHeaders(res: Response, sandboxMode: unknown) {
  // Isolated pages intentionally receive an opaque origin. A trusted page can
  // opt into same-origin compatibility, but all other sandbox restrictions
  // (including the top-navigation restriction) remain enforced by the header.
  res.setHeader('Content-Security-Policy', getCustomPageCsp(sandboxMode));
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Custom-page project files are public assets. This lets isolated pages
  // load same-project ES modules even though their sandboxed origin is opaque.
  res.setHeader('Access-Control-Allow-Origin', '*');
}

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

    if (!requestPath || requestPath.length > 1024) {
      throw new HttpException('Not found', 404);
    }

    const customPageRoot = path.join(config.staticPath, 'customPage');
    // Perform containment validation before using the path for DB or file lookups.
    resolvePathWithinRoot(customPageRoot, requestPath);
    const requestSegments = requestPath.replace(/\\/g, '/').split('/').filter(Boolean);
    if (requestSegments.length > 32) {
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
      let relativeFilePath = remainingSegments.join('/');
      let absolutePath = resolvePathWithinRoot(pageRoot, relativeFilePath);

      if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isDirectory()) {
        if (!req.path.endsWith('/')) {
          res.redirect(302, `${req.path}/`);
          return;
        }
        relativeFilePath = `${relativeFilePath}/index.html`;
        absolutePath = resolvePathWithinRoot(pageRoot, relativeFilePath);
      }

      if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
        throw new HttpException('Not found', 404);
      }

      res.sendFile(absolutePath);
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
