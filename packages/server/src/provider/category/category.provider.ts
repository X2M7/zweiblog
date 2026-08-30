import { BadRequestException, Injectable, NotAcceptableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ArticleProvider } from '../article/article.provider';
import { CategoryDocument } from 'src/scheme/category.schema';
import { sleep } from 'src/utils/sleep';
import { UpdateCategoryDto } from 'src/types/category.dto';
import {
  hashContentPassword,
  hasContentPassword,
  isValidContentPasswordLength,
  MAX_CONTENT_PASSWORD_LENGTH,
} from 'src/utils/contentPassword';
import { isScryptPasswordHash } from 'src/utils/crypto';

@Injectable()
export class CategoryProvider {
  idLock = false;
  constructor(
    @InjectModel('Category') private categoryModal: Model<CategoryDocument>,
    private readonly articleProvider: ArticleProvider,
  ) {}
  async getCategoriesWithArticle(includeHidden: boolean) {
    const allArticles = await this.articleProvider.getAll('list', includeHidden);
    const categories = await this.getAllCategories();
    const data = {};
    categories.forEach((c) => {
      data[c] = [];
    });
    allArticles.forEach((a) => {
      data[a.category]?.push(a);
    });
    return data;
  }
  async getPieData() {
    const oldData = await this.getCategoriesWithArticle(true);
    const categories = Object.keys(oldData);
    if (!categories || categories.length < 0) {
      return [];
    }
    const res = [];
    categories.forEach((c) => {
      res.push({
        type: c,
        value: oldData[c].length || 0,
      });
    });
    return res;
  }

  async getAllCategories(all?: boolean) {
    const query = this.categoryModal.find({});
    if (all) query.select('+password');
    const d = await query.exec();
    if (!d || !d.length) {
      return [];
    }
    if (all)
      return d.map((item: any) => {
        const raw = { ...(item?.toObject?.() || item?._doc || item) };
        const hasPassword = hasContentPassword(raw.password);
        delete raw.password;
        delete raw._id;
        delete raw.__v;
        return { ...raw, hasPassword };
      });
    else return d.map((item) => item.name);
  }

  /** Only call from the AdminGuard-protected backup controller. */
  async exportForBackup() {
    const categories = await this.categoryModal.find({}).select('+password').lean().exec();
    return categories.map((item: any) => {
      const result = { ...item };
      delete result._id;
      delete result.__v;
      return result;
    });
  }

  /** Import data from a trusted, AdminGuard-protected backup upload. */
  async importFromBackup(categories: unknown) {
    if (categories === undefined || categories === null) return;
    if (!Array.isArray(categories)) {
      throw new BadRequestException('Backup categories must be an array');
    }

    for (const rawCategory of categories) {
      const legacyNameOnly = typeof rawCategory === 'string';
      const input: any = legacyNameOnly
        ? { name: rawCategory, private: false, type: 'category' }
        : rawCategory;
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new BadRequestException('Invalid category in backup');
      }
      if (typeof input.name !== 'string' || !input.name || input.name.length > 100) {
        throw new BadRequestException('Invalid category name in backup');
      }
      if (input.private !== undefined && typeof input.private !== 'boolean') {
        throw new BadRequestException('Invalid category privacy value in backup');
      }

      const isPrivate = input.private === true;
      let password: string | undefined;
      if (isPrivate) {
        if (!isValidContentPasswordLength(input.password)) {
          throw new BadRequestException('Private backup categories require a password');
        }
        password = isScryptPasswordHash(input.password)
          ? input.password
          : await hashContentPassword(input.password);
      }

      const existing: any = await this.categoryModal
        .findOne({ name: input.name })
        .select('+password')
        .exec();
      // Historical backups contained category names only. They can create a
      // missing category, but must not erase newer privacy settings.
      if (existing && legacyNameOnly) continue;
      const type = input.type === 'column' ? 'column' : 'category';
      const set: any = { name: input.name, type, private: isPrivate };
      if (input.meta && typeof input.meta === 'object' && !Array.isArray(input.meta)) {
        set.meta = input.meta;
      }
      if (password) set.password = password;

      if (existing) {
        await this.categoryModal.updateOne(
          { _id: existing._id },
          isPrivate ? { $set: set } : { $set: set, $unset: { password: 1 } },
        );
      } else {
        await this.categoryModal.create({
          id: await this.getNewId(),
          ...set,
        });
      }
    }
  }

  async getArticlesByCategory(name: string, includeHidden: boolean) {
    const d = await this.getCategoriesWithArticle(includeHidden);
    return d[name] ?? [];
  }

  async addOne(name: string) {
    const existData = await this.categoryModal.findOne({
      name,
    });
    if (existData) {
      throw new NotAcceptableException('分类名重复，无法创建！');
    } else {
      await this.categoryModal.create({
        id: await this.getNewId(),
        name,
        type: 'category',
        private: false,
      });
    }
  }

  async getNewId() {
    while (this.idLock) {
      await sleep(10);
    }
    this.idLock = true;
    const maxObj = await this.categoryModal.find({}).sort({ id: -1 }).limit(1);
    let res = 1;
    if (maxObj.length) {
      res = maxObj[0].id + 1;
    }
    this.idLock = false;
    return res;
  }

  async deleteOne(name: string) {
    // 先检查一下有没有这个分类的文章
    const d = await this.getArticlesByCategory(name, true);
    if (d && d.length) {
      throw new NotAcceptableException('分类已有文章，无法删除！');
    }
    await this.categoryModal.deleteOne({
      name,
    });
  }

  async updateCategoryByName(name: string, dto: UpdateCategoryDto) {
    if (Object.keys(dto).length == 0) {
      throw new NotAcceptableException('无有效信息，无法修改！');
    }
    const existing: any = await this.categoryModal.findOne({ name }).select('+password').exec();
    if (!existing) {
      throw new NotAcceptableException('Category does not exist');
    }

    const updateData: UpdateCategoryDto = { ...dto };
    if (updateData.private !== undefined && typeof updateData.private !== 'boolean') {
      throw new BadRequestException('Category private must be a boolean');
    }
    if (updateData.password !== undefined && typeof updateData.password !== 'string') {
      throw new BadRequestException('Category password must be a string');
    }
    const nextPrivate =
      typeof updateData.private === 'boolean' ? updateData.private : Boolean(existing.private);
    const newPasswordProvided = hasContentPassword(updateData.password);
    if (newPasswordProvided && !isValidContentPasswordLength(updateData.password)) {
      throw new BadRequestException(
        `Content password must contain at most ${MAX_CONTENT_PASSWORD_LENGTH} characters`,
      );
    }

    const update: any = { $set: { ...updateData } };
    delete update.$set.password;
    if (!nextPrivate) {
      update.$unset = { password: 1 };
    } else if (newPasswordProvided) {
      update.$set.password = await hashContentPassword(updateData.password);
    } else if (!hasContentPassword(existing.password)) {
      throw new BadRequestException('Private categories require a password');
    }

    if (dto.name && name != dto.name) {
      const existData = await this.categoryModal
        .findOne({
          name: dto.name,
        })
        .exec();
      if (existData) {
        throw new NotAcceptableException('分类名重复，无法修改！');
      }
      // 先修改文章分类
      const articles = await this.getArticlesByCategory(name, true);
      if (articles && articles.length) {
        for (const article of articles) {
          await this.articleProvider.updateById(article.id, {
            category: dto.name,
          });
        }
      }
    }
    await this.categoryModal.updateOne({ name }, update);
  }
}
