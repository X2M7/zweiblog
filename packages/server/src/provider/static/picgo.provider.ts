import { Injectable, Logger } from '@nestjs/common';
import { StaticType, StoragePath } from 'src/types/setting.dto';
import * as fs from 'fs';
import * as path from 'path';
import { config } from 'src/config';
import { formatBytes } from 'src/utils/size';
import { PicGo } from 'picgo';
import { ImgMeta } from 'src/types/img';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SettingDocument } from 'src/scheme/setting.schema';
import { readSafeImageMetadata } from 'src/utils/imageMetadata';
import {
  parsePicgoPluginSetting,
  summarizePicgoInstallResult,
  validatePicgoPluginNames,
} from './picgo.security';
@Injectable()
export class PicgoProvider {
  picgo: PicGo;
  logger = new Logger(PicgoProvider.name);
  constructor(
    @InjectModel('Setting')
    private settingModel: Model<SettingDocument>,
  ) {
    this.picgo = new PicGo();
    void this.initDriver().catch((error) => {
      this.logger.error(`PicGo initialization failed: ${(error as Error)?.message || 'unknown error'}`);
    });
  }
  async getSetting(): Promise<any> {
    const res = await this.settingModel.findOne({ type: 'static' }).exec();
    if (res) {
      return res?.value || { storageType: 'local', picgoConfig: null };
    }
    return null;
  }
  async initDriver() {
    const staticSetting = await this.getSetting();
    const picgoConfig = staticSetting?.picgoConfig;
    const plugins = staticSetting?.picgoPlugins;
    if (picgoConfig) {
      this.picgo.setConfig(picgoConfig);
    }
    if (plugins) {
      if (!config.picgo.allowUnsafePluginInstall) {
        this.logger.warn(
          'Skipped PicGo runtime plugin installation (picgo.allowUnsafePluginInstall=false)',
        );
        return;
      }
      await this.installPlugins(parsePicgoPluginSetting(plugins));
    }
  }
  async installPlugins(plugins: string[]) {
    if (!config.picgo.allowUnsafePluginInstall) {
      this.logger.warn('Rejected PicGo runtime plugin installation because the safety switch is off');
      return null;
    }
    const safePlugins = validatePicgoPluginNames(plugins);
    if (safePlugins.length === 0) return null;

    this.logger.log(`Installing ${safePlugins.length} PicGo plugin(s)`);
    let result;
    try {
      result = await this.picgo.pluginHandler.install(safePlugins);
    } catch (error) {
      this.logger.error(
        `PicGo plugin installation rejected or failed: ${summarizePicgoInstallResult(
          (error as Error)?.message || error,
        )}`,
      );
      throw error;
    }
    const summary = summarizePicgoInstallResult(result.body);
    if (result.success) {
      this.logger.log(`PicGo plugin installation succeeded: ${summary}`);
    } else {
      this.logger.error(`PicGo plugin installation failed: ${summary}`);
    }
    return result;
  }
  async saveFile(fileName: string, buffer: Buffer, type: StaticType) {
    const result = readSafeImageMetadata(buffer);
    const byteLength = buffer.byteLength;

    const meta: ImgMeta = { ...result, size: formatBytes(byteLength) };
    // 搞一个临时的
    const srcPath = path.join(config.staticPath, 'tmp', fileName);
    fs.writeFileSync(srcPath, buffer);
    let realPath = undefined;
    try {
      const res = await this.picgo.upload([srcPath]);
      realPath = res[0].imgUrl;
    } catch (err) {
      throw err;
    } finally {
      try {
        fs.rmSync(srcPath);
      } catch (err) {
        // console.log(err);
      }
    }
    return {
      meta,
      realPath,
    };
  }
  async deleteFile(fileName: string, type: StaticType) {
    const storagePath = StoragePath[type] || StoragePath['img'];
    const srcPath = path.join(config.staticPath, storagePath, fileName);
    fs.rmSync(srcPath);
  }
}
