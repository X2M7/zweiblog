export const PICGO_MAX_RUNTIME_PLUGINS = 20;

const NPM_PACKAGE_PART = '[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?';
const NPM_PACKAGE_NAME = new RegExp(`^(?:@${NPM_PACKAGE_PART}/)?${NPM_PACKAGE_PART}$`);

export function parseUnsafePluginInstallFlag(value: unknown) {
  return value === true || value === 'true';
}

/**
 * Accept npm registry package names only. Package versions, aliases, URLs,
 * git sources, local paths and command-line options are not valid here.
 */
export function validatePicgoPluginNames(plugins: unknown): string[] {
  if (!Array.isArray(plugins)) throw new Error('PicGo plugins must be an array');
  if (plugins.length > PICGO_MAX_RUNTIME_PLUGINS) {
    throw new Error(`PicGo plugins must not exceed ${PICGO_MAX_RUNTIME_PLUGINS} entries`);
  }

  const unique = new Set<string>();
  for (const plugin of plugins) {
    if (
      typeof plugin !== 'string' ||
      plugin.length > 214 ||
      plugin.trim() !== plugin ||
      !NPM_PACKAGE_NAME.test(plugin)
    ) {
      throw new Error('PicGo plugins must be plain npm registry package names');
    }
    unique.add(plugin);
  }
  return Array.from(unique);
}

export function parsePicgoPluginSetting(value: unknown): string[] {
  if (typeof value !== 'string' || value.trim() === '') return [];
  const plugins = value
    .split(',')
    .map((plugin) => plugin.trim())
    .filter(Boolean);
  return validatePicgoPluginNames(plugins);
}

export function summarizePicgoInstallResult(value: unknown, maxLength = 300) {
  try {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    return String(serialized)
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .slice(0, maxLength);
  } catch {
    return '[Unserializable result]';
  }
}
