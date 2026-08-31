import { resolveCaddyHttpsMode } from './caddyHttpsMode';

describe('resolveCaddyHttpsMode', () => {
  it('prefers an explicit environment mode', () => {
    expect(resolveCaddyHttpsMode('off', 'on-demand', 'legacy@example.com')).toEqual({
      mode: 'off',
      inferredFromLegacyEmail: false,
    });
  });

  it('uses a persisted mode when the environment does not override it', () => {
    expect(resolveCaddyHttpsMode('', 'on-demand', '')).toEqual({
      mode: 'on-demand',
      inferredFromLegacyEmail: false,
    });
  });

  it('keeps old installer HTTPS deployments working when they supplied an email', () => {
    expect(resolveCaddyHttpsMode(undefined, '', 'legacy@example.com')).toEqual({
      mode: 'on-demand',
      inferredFromLegacyEmail: true,
    });
  });

  it('defaults to HTTP-only and rejects ambiguous invalid legacy settings', () => {
    expect(resolveCaddyHttpsMode(undefined, '', '')).toEqual({
      mode: 'off',
      inferredFromLegacyEmail: false,
    });
    expect(() => resolveCaddyHttpsMode(undefined, '', 'not-an-email')).toThrow(
      /EMAIL must be valid/,
    );
    expect(() => resolveCaddyHttpsMode('automatic', '', '')).toThrow(
      /must be "off" or "on-demand"/,
    );
  });
});
