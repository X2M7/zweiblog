import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotImplementedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SearchStaticOption, StaticType, StorageType } from 'src/types/setting.dto';
import { Static, StaticDocument } from 'src/scheme/static.schema';
import { encryptFileMD5 } from 'src/utils/crypto';
import { ArticleProvider } from '../article/article.provider';
import { SettingProvider } from '../setting/setting.provider';
import { LocalProvider } from './local.provider';
import { PicgoProvider } from './picgo.provider';
import { ImgMeta } from 'src/types/img';
import { formatBytes } from 'src/utils/size';
import axios from 'axios';
import { UploadConfig } from 'src/types/upload';
import { addWaterMarkToIMG } from 'src/utils/watermark';
import { checkTrue } from 'src/utils/checkTrue';
import { compressImgToWebp } from 'src/utils/webp';
import { readSafeImageMetadata } from 'src/utils/imageMetadata';
import { createPinnedHttpAgents } from 'src/utils/safeRemoteUrl';
@Injectable()
export class StaticProvider {
  private readonly logger = new Logger(StaticProvider.name);

  constructor(
    @InjectModel('Static')
    private staticModel: Model<StaticDocument>,
    private readonly settingProvider: SettingProvider,
    private readonly localProvider: LocalProvider,
    private readonly picgoProvider: PicgoProvider,
    private readonly articleProvder: ArticleProvider,
  ) {}
  publicView = {
    _id: 0,
  };
  adminView = undefined;
  getView(view: 'admin' | 'public') {
    if (view == 'admin') {
      return this.adminView;
    }
    return this.publicView;
  }
  async upload(
    file: any,
    type: StaticType,
    isFavicon?: boolean,
    customPathname?: string,
    updateConfig?: UploadConfig,
  ) {
    if (!file || !Buffer.isBuffer(file.buffer)) {
      throw new BadRequestException('A file is required');
    }
    const { buffer } = file;
    const arr = file.originalname.split('.');
    const fileType = arr[arr.length - 1];
    let buf = buffer;
    let currentSign = encryptFileMD5(buf);
    let imageMetadata = type === 'img' ? readSafeImageMetadata(buf) : null;
    const staticConfigInDB = await this.settingProvider.getStaticSetting();
    if (type == 'img') {
      try {
        // 用加过水印的 buf 做计算，看看是不是有文件的。
        if (updateConfig && updateConfig.withWaterMark && imageMetadata?.type !== 'gif') {
          // 双保险，只有这里开启水印并且设置中也开启了才有效。
          const waterMarkConfigInDB = staticConfigInDB;
          if (waterMarkConfigInDB && checkTrue(waterMarkConfigInDB?.enableWaterMark)) {
            const waterMarkText = updateConfig.waterMarkText || waterMarkConfigInDB.waterMarkText;
            if (waterMarkText && waterMarkText.trim() !== '') {
              buf = await addWaterMarkToIMG(buffer, waterMarkText);
              imageMetadata = readSafeImageMetadata(buf);
              currentSign = encryptFileMD5(buf);
            }
          }
        }
      } catch (err) {
        // console.log(err);
      }

      // GIF uploads are explicitly supported by the admin UI. cwebp cannot
      // convert animated GIFs, and recompressing an existing WebP is both
      // wasteful and potentially lossy. Optional optimization must not make a
      // valid image upload fail, so preserve the validated original whenever
      // conversion is inapplicable or the converter is unavailable.
      if (
        checkTrue(staticConfigInDB.enableWebp) &&
        imageMetadata?.type !== 'gif' &&
        imageMetadata?.type !== 'webp'
      ) {
        try {
          const convertedBuffer = await compressImgToWebp(buf);
          const convertedMetadata = readSafeImageMetadata(convertedBuffer);
          // Commit the converted representation only after validating the
          // complete converter result. A converter that resolves malformed
          // bytes must not replace the already validated source image.
          buf = convertedBuffer;
          imageMetadata = convertedMetadata;
          currentSign = encryptFileMD5(convertedBuffer);
        } catch (err) {
          this.logger.warn('WebP conversion failed; saving the validated original image');
        }
      }

      const hasFile = await this.getOneBySign(currentSign);

      if (hasFile) {
        return {
          src: hasFile.realPath,
          isNew: false,
        };
      }
    }

    const detectedFileType = imageMetadata?.type || fileType;
    let fileName = `${currentSign}.${detectedFileType}`;
    if (type == 'customPage') {
      fileName = customPathname + '/' + file.originalname;
    }
    const realPath = await this.saveFile(
      detectedFileType,
      isFavicon ? `favicon.${detectedFileType}` : fileName,
      buf,
      type,
      currentSign,
      isFavicon,
    );
    if (!realPath) {
      throw new HttpException('上传失败', HttpStatus.INTERNAL_SERVER_ERROR);
    }
    return {
      src: realPath,
      isNew: true,
    };
  }

  async uploadCustomPageFile(file: any, pathname: string, filePath: string) {
    if (!file?.path) {
      throw new BadRequestException('A file is required');
    }
    const saved = await this.localProvider.saveUploadedCustomPageFile(
      pathname,
      filePath,
      file.path,
      file.size,
    );
    return {
      src: saved.realPath,
      isNew: true,
      meta: saved.meta,
    };
  }
  async importItems(items: Static[]) {
    for (const each of items) {
      const oldItem = await this.getOneBySign(each.sign);
      if (!oldItem) {
        await this.createInDB(each);
      } else {
        this.staticModel.updateOne({ _id: oldItem._id }, { each });
      }
    }
  }
  async fetchImg(link: string): Promise<Buffer | null> {
    try {
      const { url, httpAgent, httpsAgent } = await createPinnedHttpAgents(link);
      const res = await axios({
        method: 'GET',
        url,
        responseType: 'arraybuffer',
        timeout: 8_000,
        maxRedirects: 0,
        maxContentLength: 10 * 1024 * 1024,
        maxBodyLength: 10 * 1024 * 1024,
        httpAgent,
        httpsAgent,
        proxy: false,
        validateStatus: (status) => status >= 200 && status < 300,
      });
      if (
        !String(res.headers['content-type'] || '')
          .toLowerCase()
          .startsWith('image/')
      ) {
        return null;
      }
      return Buffer.from(res.data);
    } catch {
      return null;
    }
  }
  async getImgInfoByLink(link: string) {
    const buffer = await this.fetchImg(link);
    if (!buffer) {
      return null;
    }
    const result = readSafeImageMetadata(buffer);
    const meta: ImgMeta = { ...result, size: formatBytes(buffer.byteLength) };
    const filename = link.split('/').pop();
    const fileType = filename?.split('.')?.pop() || '';
    const currentSign = encryptFileMD5(buffer);
    return {
      meta,
      staticType: 'img' as StaticType,
      storageType: 'picgo' as StorageType,
      fileType: result?.type || fileType,
      realPath: link,
      name: filename,
      sign: currentSign,
    };
  }
  async scanLinksOfArticles() {
    const linkObjs = await this.articleProvder.getAllImageLinks();
    const errorLinks = [];
    let total = 0;
    for (const linkObj of linkObjs) {
      const links = linkObj.links;
      for (const link of links) {
        total = total + 1;
        const dto = await this.getImgInfoByLink(link);
        if (!dto) {
          errorLinks.push({
            artcileId: linkObj.articleId,
            title: linkObj.title,
            link,
          });
        } else {
          const hasPicture = await this.getOneBySign(dto?.sign || '');
          console.log(link, dto);
          if (!hasPicture) {
            await this.createInDB(dto);
          }
        }
      }
    }
    return { total: total, errorLinks };
  }

  async exportAllImg() {
    const storageSetting = await this.settingProvider.getStaticSetting();
    const storageType = storageSetting?.storageType || 'local';
    if (storageType == 'local') {
      const { success, path } = await this.localProvider.exportAllImg();
      if (success && path) {
        return path;
      } else {
        throw new HttpException({ statusCode: 500, message: '打包错误！' }, 500);
      }
    } else {
      throw new NotImplementedException('其他图床暂不支持打包导出！');
    }
  }
  async saveFile(
    fileType: string,
    fileName: string,
    buffer: Buffer,
    type: StaticType,
    sign: string,
    toRootPath?: boolean,
  ) {
    const storageSetting = await this.settingProvider.getStaticSetting();
    let storageType = storageSetting?.storageType || 'local';
    if (type == 'customPage') {
      storageType = 'local';
    }
    switch (storageType) {
      case 'local':
        const { realPath, meta } = await this.localProvider.saveFile(
          fileName,
          buffer,
          type,
          toRootPath,
        );
        if (type != 'customPage') {
          await this.createInDB({
            fileType: (meta as any)?.type || fileType,
            staticType: type,
            storageType: storageType,
            sign,
            name: fileName,
            realPath,
            meta,
          });
        }
        return realPath;
      case 'picgo':
        const picgoRes = await this.picgoProvider.saveFile(fileName, buffer, type);
        await this.createInDB({
          fileType: picgoRes.meta?.type || fileType,
          staticType: type,
          storageType: storageType,
          sign,
          name: fileName,
          realPath: picgoRes.realPath,
          meta: picgoRes.meta,
        });
        return picgoRes.realPath;
    }
  }
  async createInDB(dto: Partial<Static>) {
    const newModal = new this.staticModel(dto);
    return await newModal.save();
  }
  async getOneBySign(sign: string) {
    return await this.staticModel.findOne({ sign }).exec();
  }
  async getAll(type: StaticType, view: 'admin' | 'public') {
    return await this.staticModel.find({ staticType: type }, this.getView(view)).exec();
  }
  async exportAll() {
    return await this.staticModel.find({}, this.getView('public')).exec();
  }
  async getByOption(option: SearchStaticOption) {
    const query: any = {};
    if (option.staticType) {
      query.staticType = option.staticType;
    }
    const total = await this.staticModel.count(query);
    const items = await this.staticModel
      .find(query, this.getView(option.view))
      .sort({ updatedAt: -1 })
      .limit(option.pageSize)
      .skip(option.page * option.pageSize - option.pageSize);
    return {
      total,
      data: items,
    };
  }
  async deleteCustomPage(path: string) {
    const folderName = path.replace('/', '');
    // 直接删除文件夹
    await this.localProvider.deleteCustomPageFolder(folderName);
  }

  async getFolderFiles(path: string) {
    return this.localProvider.getFolderFiles(path);
  }
  async getFileContent(path: string, subPath: string) {
    return this.localProvider.getFileContent(path, subPath);
  }
  async createFile(path: string, subPath: string) {
    return this.localProvider.createFile(path, subPath);
  }
  async createFolder(path: string, subPath: string) {
    return this.localProvider.createFolder(path, subPath);
  }
  async updateCustomPageFileContent(pathname: string, filePath: string, content: string) {
    return this.localProvider.updateCustomPageFileContent(pathname, filePath, content);
  }
  async renameCustomPageFile(pathname: string, filePath: string, newBaseName: string) {
    return this.localProvider.renameCustomPageFile(pathname, filePath, newBaseName);
  }
  async deleteCustomPageFile(pathname: string, filePath: string) {
    return this.localProvider.deleteCustomPageFile(pathname, filePath);
  }
  async deleteCustomPageSubfolder(pathname: string, folderPath: string) {
    return this.localProvider.deleteCustomPageSubfolder(pathname, folderPath);
  }
  async exportCustomPageProject(pathname: string, type: 'file' | 'folder', html?: string) {
    return this.localProvider.exportCustomPageProject(pathname, type, html);
  }

  async deleteOneBySign(sign: string) {
    // 先删除实际上的。
    const toDeleteData = await this.staticModel.findOne({ sign }).exec();
    const storageType = toDeleteData.storageType;
    switch (storageType) {
      case 'local':
        await this.localProvider.deleteFile(toDeleteData.name, toDeleteData.staticType);
        break;
      case 'picgo':
        console.log('实际上只删了数据库，网盘上还有的。');
    }
    return await this.staticModel.deleteOne({ sign }).exec();
  }
  async deleteAllIMG() {
    // 调试用的
    const all = await this.getAll('img', 'admin');
    for (const each of all) {
      await this.deleteOneBySign(each.sign);
    }
  }
}
