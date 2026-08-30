import { execFile } from 'node:child_process';
import { writeFileSync, readFileSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const compressImgToWebp = async (srcImage: Buffer) => {
  const filenameTemp = `zweiblog-${randomBytes(16).toString('hex')}`;
  const inputPath = join(tmpdir(), filenameTemp);
  const outputPath = join(tmpdir(), `${filenameTemp}.webp`);

  try {
    writeFileSync(inputPath, srcImage, { mode: 0o600 });
    await new Promise<void>((resolve, reject) => {
      execFile(
        'cwebp',
        ['-quiet', '-q', '80', inputPath, '-o', outputPath],
        { timeout: 30_000, maxBuffer: 1024 * 1024 },
        (error) => {
          if (error) reject(error);
          else resolve();
        },
      );
    });

    return readFileSync(outputPath);
  } finally {
    rmSync(inputPath, { force: true });
    rmSync(outputPath, { force: true });
  }
};
