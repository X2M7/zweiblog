import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Next.js preserves JSX for its own compiler. Tests need Vite to lower it.
  oxc: { jsx: { runtime: 'automatic' } },
});
