import React, { useContext, useMemo, useState } from "react";
import { Popover, ArrowContainer } from "react-tiny-popover";
import { SocialItem } from "../../api/getAllData";
import { getIcon } from "../../utils/getIcon";
import {
  getSocialDefinition,
  getSocialLabel,
  resolveSocialHref,
  resolveSocialQrSource,
} from "../../utils/socialCatalog";
import { useSiteLanguage } from "../../utils/siteLanguage";
import { ThemeContext } from "../../utils/themeContext";
import ImageBox from "../ImageBox";

const iconSize = 20;
const controlClass =
  "inline-flex w-full min-w-0 cursor-pointer items-center justify-start overflow-hidden border-0 bg-transparent p-0 text-left text-inherit";
const inertClass =
  "inline-flex w-full min-w-0 items-center justify-start overflow-hidden opacity-70";
const iconClass =
  "ml-3 inline-flex h-5 w-5 flex-none items-center justify-center text-gray-500 transition-all dark:text-dark dark:group-hover:text-dark-r";

function Content({ item }: { item: SocialItem }) {
  const { language } = useSiteLanguage();
  const label = getSocialLabel(item.type, language);
  return (
    <>
      <span aria-hidden="true" className={iconClass}>
        {getIcon(item.type, iconSize)}
      </span>
      <span className="ml-1 min-w-0 truncate" title={label}>
        {label}
      </span>
    </>
  );
}

export default function SocialIcon({ item }: { item: SocialItem }) {
  const { theme } = useContext(ThemeContext);
  const { language, t } = useSiteLanguage();
  const [show, setShow] = useState(false);
  const definition = getSocialDefinition(item.type);
  const label = getSocialLabel(item.type, language);

  const qrCodeUrl = useMemo(() => {
    if (definition.kind !== "qr") return undefined;
    const source =
      item.type === "wechat" &&
      theme.includes("dark") &&
      item.dark?.trim()
        ? item.dark
        : item.value;
    return resolveSocialQrSource(source);
  }, [definition.kind, item, theme]);

  const arrowColor = theme.includes("dark") ? "#1b1c1f" : "white";

  if (definition.kind === "qr") {
    if (!qrCodeUrl) {
      return (
        <span className={inertClass} title={label}>
          <Content item={item} />
        </span>
      );
    }

    const accessibleLabel = t(
      `显示${label}二维码`,
      `Show ${label} QR code`,
    );
    return (
      <Popover
        isOpen={show}
        onClickOutside={() => setShow(false)}
        positions={["top", "left"]}
        content={({ position, childRect, popoverRect }) => (
          <ArrowContainer
            position={position}
            childRect={childRect}
            popoverRect={popoverRect}
            arrowColor={arrowColor}
            arrowSize={10}
            arrowStyle={{ opacity: 0.7 }}
            className=""
            arrowClassName="popover-arrow"
          >
            <div
              className="card-shadow bg-white dark:bg-dark-2 dark:card-shadow-dark"
              style={{ height: 280 }}
            >
              <ImageBox
                alt={t(`${label}二维码`, `${label} QR code`)}
                src={qrCodeUrl}
                width={200}
                height={280}
                className=""
                lazyLoad={true}
              />
            </div>
          </ArrowContainer>
        )}
      >
        <button
          type="button"
          aria-expanded={show}
          aria-label={accessibleLabel}
          className={controlClass}
          onClick={() => setShow((visible) => !visible)}
          title={label}
        >
          <Content item={item} />
        </button>
      </Popover>
    );
  }

  const href = resolveSocialHref(item.type, item.value);
  if (!href) {
    return (
      <span className={inertClass} title={label}>
        <Content item={item} />
      </span>
    );
  }

  const external = definition.kind === "external";
  return (
    <a
      className={controlClass}
      href={href}
      rel={external ? "noopener noreferrer" : undefined}
      target={external ? "_blank" : undefined}
      title={label}
    >
      <Content item={item} />
    </a>
  );
}
