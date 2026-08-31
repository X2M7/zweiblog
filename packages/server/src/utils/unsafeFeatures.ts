/**
 * Runtime package installation and pipeline JavaScript are high-trust
 * operator features, not an application sandbox. In production they can only
 * be enabled by the exact environment value `true`; a stale database/config
 * value is never sufficient. Development keeps the legacy stored opt-in.
 */
export function allowExplicitOperatorFeature(
  environmentValue: unknown,
  storedValue: unknown,
  nodeEnv: string | undefined,
) {
  if (nodeEnv === 'production') return environmentValue === 'true';
  const value = environmentValue ?? storedValue;
  return value === true || value === 'true';
}
