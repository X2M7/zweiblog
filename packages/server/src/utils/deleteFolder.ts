import { rmSync } from 'node:fs';

export const rmDir = (p: string) => {
  rmSync(p, { recursive: true, force: true });
};
