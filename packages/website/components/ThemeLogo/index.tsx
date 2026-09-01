import React from "react";

type ThemeLogoProps = {
  src: string;
  darkSrc?: string;
  alt: string;
  width?: number;
  height?: number;
  className?: string;
};

const joinClassNames = (...classNames: Array<string | undefined>) =>
  classNames.filter(Boolean).join(" ");

/**
 * Render both configured logo variants so the theme bootstrap class can pick
 * the correct one before React hydrates. Choosing `src` from React state here
 * would make the server and browser disagree about the initial markup.
 */
export default function ThemeLogo({
  src,
  darkSrc,
  alt,
  width,
  height,
  className,
}: ThemeLogoProps) {
  const hasDistinctDarkLogo = Boolean(darkSrc && darkSrc !== src);

  if (!hasDistinctDarkLogo) {
    return (
      <img
        alt={alt}
        src={src}
        width={width}
        height={height}
        className={className}
      />
    );
  }

  return (
    <>
      <img
        alt={alt}
        src={src}
        width={width}
        height={height}
        className={joinClassNames(className, "dark:hidden")}
        data-theme-logo="light"
      />
      <img
        alt={alt}
        src={darkSrc}
        width={width}
        height={height}
        className={joinClassNames(className, "hidden dark:block")}
        data-theme-logo="dark"
      />
    </>
  );
}
