import { slide as Menu } from "react-burger-menu";
import Link from "next/link";
import { useCallback } from "react";
import { MenuItem } from "../../api/getAllData";
import { getEnglishMenuName } from "../NavBar/item";
import { useSiteLanguage } from "../../utils/siteLanguage";
export default function (props: {
  isOpen: boolean;
  setIsOpen: (i: boolean) => void;
  showFriends: "true" | "false";
  showAdminButton: "true" | "false";
  menus: MenuItem[];
}) {
  const { localizedPath, t } = useSiteLanguage();
  const renderItem = useCallback((item: MenuItem, isSub?: boolean) => {
    const itemName = t(item.name, getEnglishMenuName(item.name, item.nameEn));
    if (item.value.includes("http")) {
      return (
        <li
          className="side-bar-item dark:border-dark-2 dark:hover:bg-dark-2"
          key={item.id}
        >
          <a
            className={`w-full inline-block  ${isSub ? "px-6" : "px-4"}`}
            target="_blank"
            href={item.value}
          >
            {itemName}
          </a>
        </li>
      );
    } else {
      return (
        <li
          className="side-bar-item dark:border-dark-2 dark:hover:bg-dark-2"
          key={item.id}
        >
          <Link href={localizedPath(item.value)}>
            <div className={`w-full inline-block  ${isSub ? "px-8" : "px-4"}`}>
              {itemName}
            </div>
          </Link>
        </li>
      );
    }
  }, [localizedPath, t]);
  const renderLinks = useCallback(() => {
    const arr: any[] = [];
    props.menus.forEach((item) => {
      arr.push(renderItem(item));
      if (item.children && item.children.length > 0) {
        item.children.forEach((i) => {
          arr.push(renderItem(i, true));
        });
      }
    });
    return arr;
  }, [props.menus, renderItem]);
  return (
    <>
      <div>
        <Menu
          id="nav-mobile"
          disableAutoFocus={true}
          customCrossIcon={false}
          customBurgerIcon={false}
          isOpen={props.isOpen}
          onStateChange={(state) => {
            if (state.isOpen) {
              // 要打开
              document.body.style.overflow = "hidden";
            } else {
              document.body.style.overflow = "auto";
            }

            props.setIsOpen(state.isOpen);
          }}
        >
          <ul
            onClick={() => {
              document.body.style.overflow = "auto";
              props.setIsOpen(false);
            }}
            className=" sm:flex h-full items-center  text-sm text-gray-600 hidden divide-y divide-dashed dark:text-dark "
          >
            {renderLinks()}
            {props.showAdminButton == "true" && (
              <li
                className="side-bar-item dark:border-dark-2 dark:hover:bg-dark-2"
                key={"rss-phone-nav-btn"}
              >
                <a
                  className="w-full inline-block px-4 "
                  target="_blank"
                  href={"/admin"}
                >
                  {t("后台", "Admin")}
                </a>
              </li>
            )}
          </ul>
        </Menu>
      </div>
    </>
  );
}
