import {
  parsePicgoPluginSetting,
  parseUnsafePluginInstallFlag,
  summarizePicgoInstallResult,
  validatePicgoPluginNames,
} from './picgo.security';

describe('PicGo plugin security helpers', () => {
  it('keeps runtime plugin installation disabled unless explicitly true', () => {
    expect(parseUnsafePluginInstallFlag(undefined)).toBe(false);
    expect(parseUnsafePluginInstallFlag(false)).toBe(false);
    expect(parseUnsafePluginInstallFlag('false')).toBe(false);
    expect(parseUnsafePluginInstallFlag('TRUE')).toBe(false);
    expect(parseUnsafePluginInstallFlag(true)).toBe(true);
    expect(parseUnsafePluginInstallFlag('true')).toBe(true);
  });

  it('normalizes a comma-separated setting and removes duplicates', () => {
    expect(parsePicgoPluginSetting('picgo-plugin-one, @scope/picgo-plugin-two, picgo-plugin-one')).toEqual([
      'picgo-plugin-one',
      '@scope/picgo-plugin-two',
    ]);
  });

  it.each([
    'https://example.invalid/plugin.tgz',
    'file:../plugin',
    'git+ssh:repository',
    '../plugin',
    '--config',
    'plugin@1.0.0',
  ])('rejects non-registry plugin specifications: %s', (plugin) => {
    expect(() => validatePicgoPluginNames([plugin])).toThrow('plain npm registry');
  });

  it('keeps installation summaries short and single-line', () => {
    const summary = summarizePicgoInstallResult(`line one\n${'x'.repeat(500)}`);
    expect(summary).not.toContain('\n');
    expect(summary.length).toBeLessThanOrEqual(300);
  });
});
