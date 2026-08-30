import { decode } from 'js-base64';
import Head from 'next/head';
import Script from 'next/script';
import { createElement } from 'react';

import { type HeadTag } from '../../utils/getLayoutProps';
import { isUnsafeCustomCodeEnabled, sanitizeCustomHead, sanitizeCustomHtml } from './sanitize';

export default function (props: {
  customCss?: string;
  customHtml?: string;
  customScript?: string;
  customHead?: HeadTag[];
}) {
  const safeCustomHead = sanitizeCustomHead(props.customHead);
  const safeCustomHtml = props.customHtml ? sanitizeCustomHtml(decode(props.customHtml)) : '';
  const allowUnsafeCustomCode = isUnsafeCustomCodeEnabled(
    process.env.NEXT_PUBLIC_ZWEI_BLOG_ALLOW_UNSAFE_CUSTOM_CODE,
  );
  const renderHeadTags = () => {
    if (safeCustomHead.length) {
      return (
        <>
          {safeCustomHead.map(({ content, props, name }, index) =>
            createElement(name, { ...props, key: `head-tag-${index}` }, content),
          )}
        </>
      );
    }

    return <></>;
  };

  return (
    <>
      <Head>
        {props.customCss ? <style>{decode(props.customCss)}</style> : null}
        {renderHeadTags()}
      </Head>
      {safeCustomHtml ? <div dangerouslySetInnerHTML={{ __html: safeCustomHtml }}></div> : null}
      {allowUnsafeCustomCode && props.customScript ? (
        <Script strategy="beforeInteractive">{`${decode(props.customScript)}`}</Script>
      ) : null}
    </>
  );
}
