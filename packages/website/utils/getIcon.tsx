import { SocialType } from "../api/getAllData";
import { getSocialDefinition } from "./socialCatalog";
import React, { type ComponentType } from "react";

export function getIcon(type: SocialType, size: number) {
  const Icon = getSocialDefinition(type).icon as ComponentType<{
    "aria-hidden"?: boolean | "true" | "false";
    color?: string;
    focusable?: boolean | "true" | "false";
    size?: number;
  }>;
  return (
    <Icon
      aria-hidden="true"
      color="currentColor"
      focusable="false"
      size={size}
    />
  );
}
