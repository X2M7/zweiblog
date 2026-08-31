import { BytemdPlugin } from "bytemd";
import remarkDirective from "remark-directive";
import { visit } from "unist-util-visit";
import type { Language } from "../../utils/siteLanguage";

const CUSTOM_CONTAINER_TITLE: Record<string, Record<Language, string>> = {
  note: { zh: "注", en: "Note" },
  info: { zh: "相关信息", en: "Information" },
  warning: { zh: "注意", en: "Caution" },
  danger: { zh: "警告", en: "Warning" },
  tip: { zh: "提示", en: "Tip" },
};

// FIXME: Addd Types
const customContainerPlugin = (language: Language) => (tree) => {
  visit(tree, (node) => {
    if (
      node.type === "textDirective" ||
      node.type === "leafDirective" ||
      node.type === "containerDirective"
    ) {
      if (node.type == "containerDirective") {
        const { attributes, name: tagName } = node;
        const data = node.data ??= {};
        const title = attributes?.title || CUSTOM_CONTAINER_TITLE[tagName]?.[language] || tagName;
        const cls = `custom-container ${tagName}`;

        data.hName = "div";
        data.hProperties = {
          class: cls,
          ["type"]: title,
        };
        const toAppendP = {
          type: "paragraph",
          data: {
            hProperties: {
              class: `custom-container-title ${tagName}`
            }
          },
          children: [
            {
              type: "text",
              value: title,
            }
          ]
        }
        node.children = [
          toAppendP,
          ...node.children
        ]
      }
    }
  });
};

export function customContainer(language: Language = "zh"): BytemdPlugin {
  return {
    remark: (processor) =>
      processor.use(remarkDirective).use(customContainerPlugin, language),
  };
}
