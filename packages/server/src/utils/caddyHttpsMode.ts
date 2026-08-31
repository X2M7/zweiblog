export type CaddyHttpsMode = 'off' | 'on-demand';

export interface CaddyHttpsModeResolution {
  mode: CaddyHttpsMode;
  inferredFromLegacyEmail: boolean;
}

const EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

/**
 * Resolve the bundled Caddy TLS mode without silently breaking legacy Compose
 * files. New deployments always set an explicit mode; old deployments only
 * supplied EMAIL, so a valid legacy email remains an opt-in signal for HTTPS.
 */
export function resolveCaddyHttpsMode(
  environmentMode: unknown,
  storedMode: unknown,
  legacyEmail: unknown,
): CaddyHttpsModeResolution {
  const explicitMode = String(environmentMode ?? '')
    .trim()
    .toLowerCase();
  const persistedMode = String(storedMode ?? '')
    .trim()
    .toLowerCase();
  const configuredMode = explicitMode || persistedMode;

  if (configuredMode) {
    if (configuredMode !== 'off' && configuredMode !== 'on-demand') {
      throw new Error('ZWEI_BLOG_CADDY_HTTPS must be "off" or "on-demand"');
    }
    return { mode: configuredMode, inferredFromLegacyEmail: false };
  }

  const email = String(legacyEmail ?? '').trim();
  if (!email) return { mode: 'off', inferredFromLegacyEmail: false };
  if (!EMAIL_PATTERN.test(email)) {
    throw new Error(
      'EMAIL must be valid when inferring HTTPS for a legacy deployment; set ZWEI_BLOG_CADDY_HTTPS explicitly',
    );
  }

  return { mode: 'on-demand', inferredFromLegacyEmail: true };
}
