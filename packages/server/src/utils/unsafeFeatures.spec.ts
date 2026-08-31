import { allowExplicitOperatorFeature } from './unsafeFeatures';

describe('allowExplicitOperatorFeature', () => {
  it('requires an exact deployment environment opt-in in production', () => {
    expect(allowExplicitOperatorFeature('true', false, 'production')).toBe(true);
    expect(allowExplicitOperatorFeature(true, false, 'production')).toBe(false);
    expect(allowExplicitOperatorFeature(undefined, true, 'production')).toBe(false);
    expect(allowExplicitOperatorFeature('TRUE', true, 'production')).toBe(false);
  });

  it('supports the stored opt-in outside production unless env overrides it', () => {
    expect(allowExplicitOperatorFeature(undefined, true, 'development')).toBe(true);
    expect(allowExplicitOperatorFeature('true', false, 'test')).toBe(true);
    expect(allowExplicitOperatorFeature('false', true, 'development')).toBe(false);
    expect(allowExplicitOperatorFeature(undefined, 'TRUE', 'development')).toBe(false);
  });
});
