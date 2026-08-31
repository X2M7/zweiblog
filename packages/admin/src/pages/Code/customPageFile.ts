export type CustomPageFileNameParts = {
  baseName: string;
  extension: string;
};

const INVALID_FILE_NAME_CHARACTER = /[<>:"/\\|?*\u0000-\u001f\u007f]/;
const WINDOWS_RESERVED_FILE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

/**
 * Split the last extension from a file name in the same way needed by the
 * rename dialog. Leading-dot files such as `.env` do not have an extension.
 */
export function splitCustomPageFileName(name: string): CustomPageFileNameParts {
  const lastDotIndex = name.lastIndexOf('.');

  // Match path.extname for file names: a single leading dot is part of the
  // base name, while subsequent dots start the last extension.
  if (lastDotIndex <= 0 || name === '..') {
    return { baseName: name, extension: '' };
  }

  return {
    baseName: name.slice(0, lastDotIndex),
    extension: name.slice(lastDotIndex),
  };
}

/** Normalize platform-specific tree keys to the web-facing slash format. */
export function normalizeCustomPageFileKey(key: string): string {
  return key
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/^(?:\.\/)+/, '')
    .replace(/^\/+|\/+$/g, '');
}

export function getCustomPageFileParent(key: string): string {
  const normalizedKey = normalizeCustomPageFileKey(key);
  const separatorIndex = normalizedKey.lastIndexOf('/');
  return separatorIndex < 0 ? '' : normalizedKey.slice(0, separatorIndex);
}

export function getRenamedCustomPageFileKey(key: string, newName: string): string {
  const parent = getCustomPageFileParent(key);
  return normalizeCustomPageFileKey(parent ? `${parent}/${newName}` : newName);
}

/** Collect every directory key so asynchronously loaded trees can start expanded. */
export function getCustomPageDirectoryKeys(nodes: any[]): string[] {
  const keys: string[] = [];

  for (const node of nodes || []) {
    if (node?.type === 'directory') {
      keys.push(normalizeCustomPageFileKey(String(node.key || '')));
    }
    if (Array.isArray(node?.children)) {
      keys.push(...getCustomPageDirectoryKeys(node.children));
    }
  }

  return keys.filter(Boolean);
}

export function isCustomPageKeyWithinDirectory(key: string, directoryKey: string): boolean {
  const normalizedKey = normalizeCustomPageFileKey(key);
  const normalizedDirectoryKey = normalizeCustomPageFileKey(directoryKey);
  return Boolean(
    normalizedDirectoryKey &&
      (normalizedKey === normalizedDirectoryKey ||
        normalizedKey.startsWith(`${normalizedDirectoryKey}/`)),
  );
}

export function countCustomPageDirectoryContents(node: any): {
  files: number;
  directories: number;
} {
  let files = 0;
  let directories = 0;

  for (const child of Array.isArray(node?.children) ? node.children : []) {
    if (child?.type === 'directory') {
      directories += 1;
      const nested = countCustomPageDirectoryContents(child);
      files += nested.files;
      directories += nested.directories;
    } else if (child?.type === 'file') {
      files += 1;
    }
  }

  return { files, directories };
}

export function removeCustomPageTreeNode(nodes: any[], targetKey: string): any[] {
  const normalizedTargetKey = normalizeCustomPageFileKey(targetKey);

  return (nodes || [])
    .filter((node) => normalizeCustomPageFileKey(String(node?.key || '')) !== normalizedTargetKey)
    .map((node) =>
      Array.isArray(node?.children)
        ? { ...node, children: removeCustomPageTreeNode(node.children, normalizedTargetKey) }
        : node,
    );
}

function getUtf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * Validate the editable part of a file name. The original last extension is
 * supplied separately because renaming a custom-page file preserves it.
 */
export function validateCustomPageFileBaseName(
  baseName: string,
  extension: string,
): string | undefined {
  if (!baseName || !baseName.trim()) {
    return '文件名不能为空';
  }
  if (baseName.trim() !== baseName) {
    return '文件名不能以空白字符开头或结尾';
  }
  if (baseName === '.' || baseName === '..') {
    return '文件名不能是“.”或“..”';
  }

  const fileName = `${baseName}${extension}`;
  if (INVALID_FILE_NAME_CHARACTER.test(fileName)) {
    return '文件名不能包含控制字符或以下字符：< > : " / \\ | ? *';
  }
  if (baseName.endsWith('.') || fileName.endsWith('.')) {
    return '文件名不能以句点结尾';
  }
  if (WINDOWS_RESERVED_FILE_NAME.test(fileName)) {
    return '文件名不能使用 Windows 保留名称';
  }
  if (getUtf8ByteLength(fileName) > 255) {
    return '文件名不能超过 255 个 UTF-8 字节';
  }

  return undefined;
}
