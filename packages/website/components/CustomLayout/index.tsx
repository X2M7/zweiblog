import { decode } from 'js-base64';
import Head from 'next/head';
import Script from 'next/script';
import { createElement } from 'react';

import { type HeadTag } from '../../utils/getLayoutProps';
import { isTrustedCustomCodeEnabled, sanitizeCustomHead, sanitizeCustomHtml } from './sanitize';

export default function (props: {
  customCss?: string;
  customHtml?: string;
  customScript?: string;
  customHead?: HeadTag[];
  allowTrustedCustomCode?: boolean;
}) {
  const safeCustomHead = sanitizeCustomHead(props.customHead);
  const safeCustomHtml = props.customHtml ? sanitizeCustomHtml(decode(props.customHtml)) : '';
  const allowTrustedCustomCode = isTrustedCustomCodeEnabled(props.allowTrustedCustomCode);
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
      {allowTrustedCustomCode && props.customScript ? (
        <Script strategy="beforeInteractive">{`${decode(props.customScript)}`}</Script>
      ) : null}
    </>
  );
}
