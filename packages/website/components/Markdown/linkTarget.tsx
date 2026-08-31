import { BytemdPlugin } from "bytemd";
import { visit } from "unist-util-visit";
import {
  buildLocalizedPath,
  type Language,
} from "../../utils/siteLanguage";

export function localizeMarkdownHref(
  href: unknown,
  language: Language,
): unknown {
  return typeof href === "string" ? buildLocalizedPath(href, language) : href;
}

const aTargetPlugin = (language: Language) => (tree) => {
  visit(tree, (node) => {
    if (node.type === "element" && node.tagName === "a") {
      node.properties.href = localizeMarkdownHref(
        node.properties.href,
        language,
      );
      node.properties.target = "_blank";
      node.properties.rel = "noopener noreferrer";
    }
  });
}

export function LinkTarget(language: Language = "zh"): BytemdPlugin {
  return {
    rehype: (processor) => processor.use(aTargetPlugin, language),
  };
}
