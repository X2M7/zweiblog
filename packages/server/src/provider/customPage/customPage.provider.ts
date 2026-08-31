import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CustomPage, CustomPageDocument } from 'src/scheme/customPage.schema';
import { normalizeManagedPath } from 'src/utils/safePath';

function normalizeSandboxMode(value: unknown) {
  if (value === undefined || value === null || value === '') return 'isolated' as const;
  if (value === 'isolated' || value === 'trusted') return value;
  throw new BadRequestException('Invalid custom page sandbox mode');
}

@Injectable()
export class CustomPageProvider {
  constructor(
    @InjectModel('CustomPage')
    private customPageModal: Model<CustomPageDocument>,
  ) {}
  async createCustomPage(dto: CustomPage) {
    const normalizedPath = normalizeManagedPath(dto.path);
    if (!['file', 'folder'].includes(dto.type)) {
      throw new BadRequestException('Invalid custom page type');
    }
    const old = await this.customPageModal.findOne({ path: normalizedPath });
    if (old) {
      throw new ForbiddenException('已有此路由的自定义页面！无法重复创建！');
    }
    return await this.customPageModal.create({
      name: dto.name,
      path: normalizedPath,
      type: dto.type,
      html: dto.type === 'file' ? dto.html || '' : '',
      sandboxMode: normalizeSandboxMode(dto.sandboxMode),
    });
  }
  async updateCustomPage(dto: CustomPage) {
    const normalizedPath = normalizeManagedPath(dto.path);
    const update: Partial<CustomPage> = {
      name: dto.name,
      updatedAt: new Date(),
    };
    if (typeof dto.html === 'string') update.html = dto.html;
    if (dto.sandboxMode !== undefined) {
      update.sandboxMode = normalizeSandboxMode(dto.sandboxMode);
    }
    return await this.customPageModal.updateOne({ path: normalizedPath }, update);
  }
  async getCustomPageByPath(path: string) {
    return await this.customPageModal.findOne({ path: normalizeManagedPath(path) });
  }
  async getAll() {
    return await this.customPageModal.find({}, { html: 0 });
  }
  async deleteByPath(path: string) {
    return await this.customPageModal.deleteOne({ path: normalizeManagedPath(path) });
  }
}
