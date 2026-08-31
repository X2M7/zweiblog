import * as fs from 'fs';
import * as path from 'path';
import { checkOrCreate } from './checkFolder';
enum FileType {
  'directory',
  'file',
}

interface IFile {
  title: string;
  key: string;
  type: 'directory' | 'file';
  parent: string;
  mtime: number;
  children?: IFile[];
}

function toPortablePath(value: string) {
  return value.replace(/\\/g, '/');
}

export function dirSort(a: IFile, b: IFile) {
  if (a.type !== b.type) return FileType[a.type] < FileType[b.type] ? -1 : 1;
  else if (a.mtime !== b.mtime) return a.mtime > b.mtime ? -1 : 1;
}
export function readDirs(dir: string, baseDir = '', blacklist: string[] = []) {
  const relativePath = toPortablePath(path.relative(baseDir, dir));
  checkOrCreate(dir);
  const files = fs.readdirSync(dir);
  const result: any = files
    .filter((x) => !blacklist.includes(x))
    .map((file: string) => {
      const subPath = path.join(dir, file);
      const stats = fs.lstatSync(subPath);
      if (stats.isSymbolicLink()) {
        return null;
      }
      const key = [relativePath, file].filter(Boolean).join('/');
      if (stats.isDirectory()) {
        return {
          title: file,
          key,
          type: 'directory',
          parent: relativePath,
          mtime: stats.mtime.getTime(),
          children: readDirs(subPath, baseDir).sort(dirSort),
        };
      }
      return {
        title: file,
        type: 'file',
        isLeaf: true,
        key,
        parent: relativePath,
        mtime: stats.mtime.getTime(),
      };
    })
    .filter(Boolean);
  return result.sort(dirSort);
}

export function readDir(dir: string, baseDir = '', blacklist: string[] = []) {
  const relativePath = toPortablePath(path.relative(baseDir, dir));
  const files = fs.readdirSync(dir);
  const result: any = files
    .filter((x) => !blacklist.includes(x))
    .map((file: string) => {
      const subPath = path.join(dir, file);
      const stats = fs.statSync(subPath);
      const key = [relativePath, file].filter(Boolean).join('/');
      return {
        title: file,
        type: stats.isDirectory() ? 'directory' : 'file',
        key,
        parent: relativePath,
      };
    });
  return result;
}
