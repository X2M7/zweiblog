/**
 * Runtime package installation and arbitrary JavaScript execution are not an
 * application-level sandbox. Keep both unavailable in production even when a
 * stale configuration file still contains an old opt-in flag.
 */
export function allowUnsafeDevelopmentFeature(value: unknown, nodeEnv: string | undefined) {
  return nodeEnv !== 'production' && (value === true || value === 'true');
}
