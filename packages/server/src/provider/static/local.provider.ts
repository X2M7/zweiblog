import { Injectable } from '@nestjs/common';
import { StaticType, StoragePath } from 'src/types/setting.dto';
import * as fs from 'fs';
import * as path from 'path';
import { config } from 'src/config';
import { formatBytes } from 'src/utils/size';
import { ImgMeta } from 'src/types/img';
import { isProd } from 'src/utils/isProd';
import compressing from 'compressing';
import dayjs from 'dayjs';
import { checkOrCreate, checkOrCreateByFilePath } from 'src/utils/checkFolder';
import { rmDir } from 'src/utils/deleteFolder';
import { readDirs } from 'src/utils/readFileList';
import { checkOrCreateFile } from 'src/utils/checkFile';
import {
  normalizeManagedPath,
  relativePathFromRoot,
  resolvePathWithinRoot,
} from 'src/utils/safePath';
import { readSafeImageMetadata } from 'src/utils/imageMetadata';

@Injectable()
export class LocalProvider {
  private getStorageRoot(type: StaticType) {
    return path.join(config.staticPath, StoragePath[type] || StoragePath.img);
  }

  async saveFile(fileName: string, buffer: Buffer, type: StaticType, toRootPath?: boolean) {
    if (type == 'img') {
      return await this.saveImg(fileName, buffer, type, toRootPath);
    } else if (type == 'customPage') {
      const storagePath = StoragePath.customPage;
      const storageRoot = this.getStorageRoot(type);
      const srcPath = resolvePathWithinRoot(storageRoot, fileName);
      const realName = relativePathFromRoot(storageRoot, srcPath);
      // 创建文件夹。
      const byteLength = buffer.byteLength;
      const realPath = `/static/${storagePath}/${realName}`;
      checkOrCreateByFilePath(srcPath);
      fs.writeFileSync(srcPath, buffer);
      const meta = { size: formatBytes(byteLength) };
      return {
        meta,
        realPath,
      };
    }
  }

  async getFolderFiles(p: string) {
    const storageRoot = this.getStorageRoot('customPage');
    const absPath = resolvePathWithinRoot(storageRoot, p);
    const res = readDirs(absPath, absPath);
    return res;
  }
  async createFile(p: string, subPath: string) {
    const storageRoot = this.getStorageRoot('customPage');
    const absPath = resolvePathWithinRoot(storageRoot, p, subPath || '');
    checkOrCreateFile(absPath);
  }
  async createFolder(p: string, subPath: string) {
    const storageRoot = this.getStorageRoot('customPage');
    const absPath = resolvePathWithinRoot(storageRoot, p, subPath || '');
    checkOrCreate(absPath);
  }
  async getFileContent(p: string, subPath: string) {
    const storageRoot = this.getStorageRoot('customPage');
    const absPath = resolvePathWithinRoot(storageRoot, p, subPath || '');

    const r = fs.readFileSync(absPath, { encoding: 'utf-8' });
    return r;
  }
  async updateCustomPageFileContent(pathname: string, filePath: string, content: string) {
    const storageRoot = this.getStorageRoot('customPage');
    const absPath = resolvePathWithinRoot(storageRoot, pathname, filePath);
    fs.writeFileSync(absPath, content, { encoding: 'utf-8' });
  }

  async saveImg(fileName: string, buffer: Buffer, type: StaticType, toRootPath?: boolean) {
    const storageRoot = this.getStorageRoot(type);
    const srcPath = resolvePathWithinRoot(storageRoot, fileName);
    let realPath = `/static/${type}/${fileName}`;

    if (isProd()) {
      if (toRootPath) {
        realPath = `/${fileName}`;
      }
    }
    const result = readSafeImageMetadata(buffer);
    const byteLength = buffer.byteLength;

    fs.writeFileSync(srcPath, buffer);
    const meta: ImgMeta = { ...result, size: formatBytes(byteLength) };
    return {
      meta,
      realPath,
    };
  }

  async deleteCustomPageFolder(name: string) {
    const storageRoot = this.getStorageRoot('customPage');
    const srcPath = resolvePathWithinRoot(storageRoot, normalizeManagedPath(name));
    try {
      rmDir(srcPath);
    } catch (err) {
      console.log('删除实际文件夹失败：', name);
    }
  }

  async deleteFile(fileName: string, type: StaticType) {
    try {
      const storageRoot = this.getStorageRoot(type);
      const srcPath = resolvePathWithinRoot(storageRoot, fileName);
      fs.rmSync(srcPath);
    } catch (err) {
      console.log('删除实际文件失败：', fileName, '可能是更新版本后没映射静态文件目录导致的');
    }
  }
  async exportAllImg() {
    const src = path.join(config.staticPath, 'img');
    const dst = path.join(
      config.staticPath,
      'export',
      `export-img-${dayjs().format('YYYY-MM-DD')}.zip`,
    );
    const dstSrc = `/static/export/export-img-${dayjs().format('YYYY-MM-DD')}.zip`;

    const compressPromise = new Promise((resolve, reject) => {
      compressing.zip
        .compressDir(src, dst)
        .then((v) => {
          resolve(v);
        })
        .catch((e) => {
          reject(e);
        });
    });
    try {
      const r = await Promise.all([compressPromise]);
      console.log(r);
      return {
        success: true,
        path: dstSrc,
      };
    } catch (err) {
      console.log(err);
      return {
        success: false,
        error: err,
      };
    }
  }
}
