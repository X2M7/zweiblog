import Link from "next/link";
import { MouseEventHandler, useMemo, useRef, useState } from "react";
import { MenuItem } from "../../api/getAllData";
import { useSiteLanguage } from "../../utils/siteLanguage";

const BUILT_IN_MENU_ENGLISH: Record<string, string> = {
  首页: "Home",
  标签: "Tags",
  分类: "Categories",
  时间线: "Timeline",
  友链: "Friends",
  关于: "About",
  笔记: "Notes",
  公开课: "Open Courses",
  工具: "Tools",
};

export function getEnglishMenuName(name: string, nameEn?: string): string {
  return nameEn?.trim() || BUILT_IN_MENU_ENGLISH[name.trim()] || name;
}

function LinkItemAtom(props: {
  item: MenuItem;
  onMouseEnter?: MouseEventHandler<HTMLLIElement>;
  onMouseLeave?: MouseEventHandler<HTMLLIElement>;
  children?: React.ReactNode;
  clsA?: string;
  cls?: string;
}) {
  const { item } = props;
  const { localizedPath, t } = useSiteLanguage();
  const itemName = t(item.name, getEnglishMenuName(item.name, item.nameEn));
  const cls = `nav-item transform hover:scale-110 dark:border-nav-dark  dark:transition-all ua`;
  const clsA = `h-full flex items-center px-2 md:px-4 `;
  if (item.value.includes("http")) {
    return (
      <li
        onMouseEnter={props?.onMouseEnter}
        onMouseLeave={props?.onMouseLeave}
        key={item.id}
        className={props.cls ? props.cls : cls}
      >
        <a
          className={props.clsA ? props.clsA : clsA}
          href={item.value}
          target="_blank"
        >
          {itemName}
        </a>
        {props?.children}
      </li>
    );
  } else {
    return (
      <li
        onMouseEnter={props?.onMouseEnter}
        onMouseLeave={props?.onMouseLeave}
        key={item.id}
        className={props.cls ? props.cls : cls}
      >
        <Link href={localizedPath(item.value)} style={{ height: "100%" }}>
          <div className={props.clsA ? props.clsA : clsA}>{itemName}</div>
        </Link>
      </li>
    );
  }
}

function LinkItemWithChildren(props: { item: MenuItem }) {
  const { item } = props;
  const [hover, setHover] = useState(false);
  const [hoverSub, setHoverSub] = useState(false);
  const show = useMemo(() => {
    return hover || hoverSub;
  }, [hover, hoverSub]);

  return (
    <>
      <div className="h-full relative">
        <LinkItemAtom
          item={item}
          onMouseEnter={() => {
            setHover(true);
          }}
          onMouseLeave={() => {
            setHover(false);
          }}
        />

        <div
          className="card-shadow bg-white block transition-all dark:text-dark dark:bg-dark-1 dark:card-shadow-dark"
          style={{
            position: "absolute",
            minWidth: 100,
            top: 50,
            left: "-4px",
            transform: show ? "scale(100%)" : "scale(0)",
            zIndex: 80,
          }}
          onMouseEnter={() => {
            setHoverSub(true);
          }}
          onMouseLeave={() => {
            setHoverSub(false);
          }}
        >
          {item.children?.map((c) => {
            return (
              <LinkItemAtom
                item={c}
                key={c.id}
                clsA={"h-full flex items-center px-2 md:px-4 py-2 "}
                cls={
                  "transition-all cursor-pointer flex items-center h-full hover:bg-gray-300 transition-all dark:hover:bg-dark-2  dark:text-dark dark:hover:text-dark-hover"
                }
              />
            );
          })}
        </div>
      </div>
    </>
  );
}

export default function (props: { item: MenuItem }) {
  const { item } = props;
  if (!item.children) {
    return <LinkItemAtom item={item} />;
  } else {
    return <LinkItemWithChildren item={item} />;
  }
}
