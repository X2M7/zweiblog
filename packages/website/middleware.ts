import { NextRequest, NextResponse } from "next/server";
import { getEnglishArticleRewritePath } from "./utils/articleLanguage";
import {
  getEnglishSiteRewritePath,
  getInternalLanguageRewriteUrl,
} from "./utils/siteLanguageRouting";

export function middleware(request: NextRequest) {
  const queryLanguage = request.nextUrl.searchParams.get("lang");
  const pageRewritePath =
    getEnglishArticleRewritePath(request.nextUrl.pathname, queryLanguage) ||
    getEnglishSiteRewritePath(request.nextUrl.pathname, queryLanguage);
  if (!pageRewritePath) return NextResponse.next();

  const target = getInternalLanguageRewriteUrl(
    request.nextUrl,
    pageRewritePath,
  );
  return NextResponse.rewrite(target);
}

export const config = {
  // Public HTML pages only. API, admin, custom applications, static assets and
  // Next internals must keep their original routing behavior.
  matcher: ["/((?!api(?:/|$)|admin(?:/|$)|c(?:/|$)|static(?:/|$)|_next(?:/|$)).*)"],
};
