import React from "react";
import { useSiteLanguage } from "../../utils/siteLanguage";
import type { Language } from "../../utils/siteLanguage";

export function SiteLanguageSwitchView({
  language,
  onToggle,
}: {
  language: Language;
  onToggle: () => void;
}) {
  const accessibleLabel =
    language === "zh"
      ? "切换到英文 / Switch to English"
      : "Switch to Chinese / 切换到中文";

  return (
    <div
      className="site-language-switch-wrap notranslate"
      data-testid="site-language-switch-wrap"
      translate="no"
    >
      <button
        aria-label={accessibleLabel}
        aria-pressed={language === "en"}
        className="site-language-switch notranslate"
        data-language={language}
        lang="zh-CN"
        onClick={onToggle}
        title={accessibleLabel}
        translate="no"
        type="button"
      >
        <span
          aria-hidden="true"
          className="site-language-switch-zh"
          lang="zh-CN"
        >
          中
        </span>
        <span
          aria-hidden="true"
          className="site-language-switch-en"
          lang="en"
        >
          En
        </span>
      </button>
    </div>
  );
}

export default function SiteLanguageSwitch() {
  const { language, toggleLanguage } = useSiteLanguage();
  return (
    <SiteLanguageSwitchView
      language={language}
      onToggle={toggleLanguage}
    />
  );
}
