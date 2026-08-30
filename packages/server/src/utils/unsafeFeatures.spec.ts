import { allowUnsafeDevelopmentFeature } from './unsafeFeatures';

describe('allowUnsafeDevelopmentFeature', () => {
  it('never enables unsafe execution in production', () => {
    expect(allowUnsafeDevelopmentFeature(true, 'production')).toBe(false);
    expect(allowUnsafeDevelopmentFeature('true', 'production')).toBe(false);
  });

  it('requires an exact opt-in outside production', () => {
    expect(allowUnsafeDevelopmentFeature('true', 'development')).toBe(true);
    expect(allowUnsafeDevelopmentFeature(true, 'test')).toBe(true);
    expect(allowUnsafeDevelopmentFeature('TRUE', 'development')).toBe(false);
    expect(allowUnsafeDevelopmentFeature(undefined, 'development')).toBe(false);
  });
});
