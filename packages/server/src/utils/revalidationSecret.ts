import { randomBytes } from 'node:crypto';

// This capability is separate from the backend JWT signing key. Only the
// website child receives it; a restart rotates the generated default.
const generatedSecret = randomBytes(32).toString('hex');

export function getRevalidationSecret(): string {
  return process.env.ZWEI_BLOG_REVALIDATE_SECRET?.trim() || generatedSecret;
}
