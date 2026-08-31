import Head from "next/head";
import BackToTopBtn from "../BackToTop";
import NavBar from "../NavBar";
import { useEffect, useRef, useState } from "react";
import BaiduAnalysis from "../BaiduAnalysis";
import GaAnalysis from "../gaAnalysis";
import { LayoutProps } from "../../utils/getLayoutProps";
// import ImageProvider from "../ImageProvider";
import { RealThemeType, ThemeContext } from "../../utils/themeContext";
import { getTheme } from "../../utils/theme";
import CustomLayout from "../CustomLayout";
import { Toaster } from "react-hot-toast";
import Footer from "../Footer";
import NavBarMobile from "../NavBarMobile";
import LayoutBody from "../LayoutBody";
import { useSiteLanguage } from "../../utils/siteLanguage";
import { useRouter } from "next/router";
import { getSiteLanguageMetadata, isPostPath } from "../../utils/siteLanguageMetadata";
export default function (props: {
  option: LayoutProps;
  title: string;
  sideBar: any;
  children: any;
}) {
  const { language } = useSiteLanguage();
  const router = useRouter();
  const siteName = language === "en" && props.option.siteNameEn?.trim()
    ? props.option.siteNameEn
    : props.option.siteName;
  const description = language === "en" && props.option.descriptionEn?.trim()
    ? props.option.descriptionEn
    : props.option.description;
  const languageMetadata = getSiteLanguageMetadata(router.asPath || router.pathname || "/", language);
  const hasArticleMetadata = isPostPath(router.asPath) || isPostPath(router.pathname);
  // console.log("css", props.option.customCss);
  // console.log("html", props.option.customHtml);
  // console.log("script", decode(props.option.customScript as string));
  const [isOpen, setIsOpen] = useState(false);
  const { current } = useRef({ hasInit: false });
  const [theme, setTheme] = useState<RealThemeType>(getTheme("auto"));
  const handleClose = () => {
    console.log("关闭或刷新页面");
    localStorage.removeItem("saidHello");
  };
  useEffect(() => {
    if (!current.hasInit && !localStorage.getItem("saidHello")) {
      current.hasInit = true;
      localStorage.setItem("saidHello", "true");
      console.log("🚀欢迎使用 ZweiBlog 博客系统");
      console.log("当前版本：", props?.option?.version || "未知");
      console.log("项目主页：", "https://github.com/X2M7/zweiblog");
      console.log("问题反馈：", "https://github.com/X2M7/zweiblog/issues");
      console.log("喜欢的话可以给个 star 哦🙏");
      window.onbeforeunload = handleClose;
    }
    return () => {
      document.body.style.overflow = "auto";
    };
  }, [props]);
  return (
    <>
      <Head>
        <title>{props.title}</title>
        <link rel="icon" href={props.option.favicon}></link>
        <meta key="description" name="description" content={description}></meta>
        <meta name="robots" content="index, follow"></meta>
        {!hasArticleMetadata && (
          <>
            <link href={languageMetadata.zhHref} hrefLang="zh-CN" rel="alternate" />
            <link href={languageMetadata.enHref} hrefLang="en" rel="alternate" />
            <link href={languageMetadata.xDefaultHref} hrefLang="x-default" rel="alternate" />
            <link href={languageMetadata.canonicalHref} rel="canonical" />
          </>
        )}
      </Head>
      <BackToTopBtn></BackToTopBtn>
      {props.option.baiduAnalysisID != "" &&
        process.env.NODE_ENV != "development" && (
          <BaiduAnalysis id={props.option.baiduAnalysisID}></BaiduAnalysis>
        )}

      {props.option.gaAnalysisID != "" &&
        process.env.NODE_ENV != "development" && (
          <GaAnalysis id={props.option.gaAnalysisID}></GaAnalysis>
        )}
      <ThemeContext.Provider
        value={{
          setTheme,
          theme,
        }}
      >
        <Toaster />
        {/* <ImageProvider> */}
          <NavBar
            openArticleLinksInNewWindow={
              props.option.openArticleLinksInNewWindow == "true"
            }
            showRSS={props.option.showRSS}
            defaultTheme={props.option.defaultTheme}
            showSubMenu={props.option.showSubMenu}
            headerLeftContent={props.option.headerLeftContent}
            subMenuOffset={props.option.subMenuOffset}
            showAdminButton={props.option.showAdminButton}
            menus={props.option.menus}
            siteName={siteName}
            logo={props.option.logo}
            categories={props.option.categories}
            categoryNamesEn={props.option.categoryNamesEn}
            tagNamesEn={props.option.tagNamesEn}
            isOpen={isOpen}
            setOpen={setIsOpen}
            logoDark={props.option.logoDark}
            showFriends={props.option.showFriends}
          ></NavBar>
          <NavBarMobile
            isOpen={isOpen}
            setIsOpen={setIsOpen}
            showAdminButton={props.option.showAdminButton}
            showFriends={props.option.showFriends}
            menus={props.option.menus}
          />

          <div className=" mx-auto  lg:px-6  md:py-4 py-2 px-2 md:px-4  text-gray-700 ">
            <LayoutBody children={props.children} sideBar={props.sideBar} />
            <Footer
              ipcHref={props.option.ipcHref}
              ipcNumber={props.option.ipcNumber}
              since={props.option.since}
              version={props.option.version}
              gaBeianLogoUrl={props.option.gaBeianLogoUrl}
              gaBeianNumber={props.option.gaBeianNumber}
              gaBeianUrl={props.option.gaBeianUrl}
            />
          </div>
        {/* </ImageProvider> */}
      </ThemeContext.Provider>
      {props.option.enableCustomizing == "true" && (
        <CustomLayout
          customCss={props.option.customCss}
          customHtml={props.option.customHtml}
          customScript={props.option.customScript}
          customHead={props.option.customHead}
          allowTrustedCustomCode={props.option.allowTrustedCustomCode}
        />
      )}
    </>
  );
}
