import React, { useMemo } from "react";
import { SocialItem } from "../../api/getAllData";
import SocialIcon from "../SocialIcon";

export function buildSocialRows(socials: SocialItem[] = []): SocialItem[][] {
  const darkWechat = socials.find((item) => item.type === "wechat-dark");
  const visible = socials
    .filter((item) => item.type !== "wechat-dark")
    .map((item) =>
      item.type === "wechat" && darkWechat
        ? { ...item, dark: darkWechat.value }
        : item,
    );

  const rows: SocialItem[][] = [];
  for (let index = 0; index < visible.length; index += 2) {
    rows.push(visible.slice(index, index + 2));
  }
  return rows;
}

export default function SocialCard({ socials }: { socials: SocialItem[] }) {
  const rows = useMemo(() => buildSocialRows(socials), [socials]);

  const renderEach = (item: SocialItem | undefined, index: number) => (
    <div
      className="group mx-1 mb-1 flex w-1/2 min-w-0 items-center rounded-sm text-xs text-gray-500 transition-all hover:bg-gray-200 dark:text-dark dark:hover:bg-dark-light dark:hover:text-dark-r"
      key={item ? `${item.type}-${item.value}-${index}` : `empty-${index}`}
      style={{ padding: "2px 0" }}
    >
      {item ? <SocialIcon item={item} /> : null}
    </div>
  );

  return (
    <div className="flex flex-col items-center justify-center">
      {rows.map((row, index) => (
        <div
          className="flex w-full flex-row items-center justify-between"
          key={`social-row-${index}`}
        >
          {renderEach(row[0], index * 2)}
          {renderEach(row[1], index * 2 + 1)}
        </div>
      ))}
    </div>
  );
}
