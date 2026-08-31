import NextDocument, {
  DocumentContext,
  DocumentInitialProps,
  Head,
  Html,
  Main,
  NextScript,
} from "next/document";
import Script from "next/script";
import { getTheme, initTheme } from "../utils/theme";
import { isInternalEnglishPath } from "../utils/siteLanguageRouting";

const initializeSiteLanguage = `(function(){try{var normalize=function(value){value=String(value||'').toLowerCase();if(value==='en')return'en';if(value==='zh'||value==='zh-cn')return'zh';return'';};var query=normalize(new URLSearchParams(window.location.search).get('lang'));var stored=normalize(window.localStorage.getItem('zweiblog.site-language'));var legacy=normalize(window.localStorage.getItem('zweiblog.article-language'));var initial=normalize(document.documentElement.lang);var language=query||stored||legacy||initial||'zh';window.localStorage.setItem('zweiblog.site-language',language);window.localStorage.setItem('zweiblog.article-language',language);document.documentElement.lang=language==='en'?'en':'zh-CN';document.documentElement.setAttribute('data-site-language',language);}catch(error){document.documentElement.lang=document.documentElement.lang||'zh-CN';}})();`;

type SiteDocumentProps = DocumentInitialProps & {
  documentLanguage: "zh" | "en";
};

export default class Document extends NextDocument<SiteDocumentProps> {
  static async getInitialProps(ctx: DocumentContext) {
    const initialProps = await NextDocument.getInitialProps(ctx);
    return {
      ...initialProps,
      documentLanguage: isInternalEnglishPath(ctx.pathname) ? "en" : "zh",
    };
  }

  render() {
    const documentLanguage = this.props.documentLanguage || "zh";
    return (
      <Html
        className={getTheme(initTheme()).replace("auto-", "")}
        lang={documentLanguage === "en" ? "en" : "zh-CN"}
        suppressHydrationWarning
      >
        <Head>
          <Script src="/initTheme.js" strategy="beforeInteractive" />
          <Script
            id="init-site-language"
            strategy="beforeInteractive"
            dangerouslySetInnerHTML={{ __html: initializeSiteLanguage }}
          />
        </Head>
        <body>
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }
}
