import * as fs from 'fs';
import * as path from 'node:path';

export const checkOrCreate = (p: string) => {
  try {
    fs.readdirSync(p);
  } catch (err) {
    console.log(`${p}不存在，创建。`);
    fs.mkdirSync(p, { recursive: true });
  }
};

export const checkFolder = (p: string) => {
  try {
    fs.readdirSync(p);
  } catch (err) {
    return false;
  }
  return true;
};

export const checkOrCreateByFilePath = (p: string) => {
  const folderPath = path.dirname(p);
  try {
    fs.readdirSync(folderPath);
  } catch (err) {
    console.log(`${folderPath}不存在，创建。`);
    fs.mkdirSync(folderPath, { recursive: true });
  }
};
