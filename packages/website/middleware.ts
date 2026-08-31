import { NextRequest, NextResponse } from "next/server";
import { getEnglishArticleRewritePath } from "./utils/articleLanguage";
import {
  getEnglishNotFoundRewritePath,
  getEnglishSiteRewritePath,
} from "./utils/siteLanguageRouting";

export function middleware(request: NextRequest) {
  const queryLanguage = request.nextUrl.searchParams.get("lang");
  const pageRewritePath =
    getEnglishArticleRewritePath(request.nextUrl.pathname, queryLanguage) ||
    getEnglishSiteRewritePath(request.nextUrl.pathname, queryLanguage);
  // Run the known-page check first so valid dotted article slugs remain
  // localizable, while requests for files such as /logo.svg are never turned
  // into an English 404 page.
  const looksLikeAsset = /\/[^/]+\.[^/]+$/.test(request.nextUrl.pathname);
  const rewritePath =
    pageRewritePath ||
    (!looksLikeAsset
      ? getEnglishNotFoundRewritePath(request.nextUrl.pathname, queryLanguage)
      : null);
  if (!rewritePath) return NextResponse.next();

  const target = request.nextUrl.clone();
  target.pathname = rewritePath;
  return NextResponse.rewrite(
    target,
    pageRewritePath ? undefined : { status: 404 },
  );
}

export const config = {
  // Public HTML pages only. API, admin, custom applications, static assets and
  // Next internals must keep their original routing behavior.
  matcher: ["/((?!api(?:/|$)|admin(?:/|$)|c(?:/|$)|static(?:/|$)|_next(?:/|$)).*)"],
};
