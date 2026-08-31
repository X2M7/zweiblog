import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Article } from 'src/scheme/article.schema';
import { TagDocument } from 'src/scheme/tag.schema';
import { TagDetail, UpdateTagDto } from 'src/types/tag.dto';
import { assertTextFields, LOCALIZED_NAME_MAX_LENGTH } from 'src/utils/localizedMetadata';
import { ArticleProvider } from '../article/article.provider';

@Injectable()
export class TagProvider {
  constructor(
    private readonly articleProvider: ArticleProvider,
    @InjectModel('Tag') private readonly tagModel: Model<TagDocument>,
  ) {}
  async getTagsWithArticle(includeHidden: boolean) {
    const allArticles = await this.articleProvider.getAll('list', includeHidden);
    const data = {};
    allArticles.forEach((a) => {
      a.tags.forEach((t) => {
        if (!Object.keys(data).includes(t)) {
          data[t] = [a];
        } else {
          data[t].push(a);
        }
      });
    });
    return data;
  }
  //TODO tag 改为缓存模式
  async getAllTags(includeHidden: boolean) {
    const d = await this.getTagsWithArticle(includeHidden);
    return Object.keys(d).sort((a, b) => a.localeCompare(b));
  }

  async getTagDetails(includeHidden: boolean): Promise<Array<{ name: string; nameEn: string }>> {
    const names = await this.getAllTags(includeHidden);
    if (!names.length) return [];
    const stored = await this.tagModel
      .find({ name: { $in: names } }, { name: 1, nameEn: 1, _id: 0 })
      .lean()
      .exec();
    const translations = new Map(
      stored.map((item: any) => [item.name, typeof item.nameEn === 'string' ? item.nameEn : '']),
    );
    return names.map((name) => ({ name, nameEn: translations.get(name) || '' }));
  }

  async getColumnData(topNum: number, includeHidden: boolean) {
    const data = await this.getTagsWithArticle(includeHidden);
    const tags = Object.keys(data);
    if (!tags || tags.length <= 0) {
      return [];
    }
    const res = [];
    const sortedTags = tags.sort((a, b) => {
      return data[b].length - data[a].length;
    });
    let i = 0;
    for (const t of sortedTags) {
      if (i == topNum) {
        break;
      }
      res.push({
        type: t,
        value: data[t].length || 0,
      });
      i = i + 1;
    }

    return res;
  }
  async getArticlesByTag(tagName: string, includeHidden: boolean) {
    const d = await this.getTagsWithArticle(includeHidden);
    return d[tagName] ?? [];
  }
  async updateTagByName(oldName: string, update: string | UpdateTagDto) {
    const dto: UpdateTagDto = typeof update === 'string' ? { name: update } : { ...(update || {}) };
    assertTextFields(
      { oldName, ...dto },
      [
        { field: 'oldName', maxLength: 100, required: true },
        { field: 'name', maxLength: 100 },
        { field: 'nameEn', maxLength: LOCALIZED_NAME_MAX_LENGTH },
      ],
      'Tag',
    );
    if (
      !Object.prototype.hasOwnProperty.call(dto, 'name') &&
      !Object.prototype.hasOwnProperty.call(dto, 'nameEn')
    ) {
      throw new BadRequestException('Tag update requires name or nameEn');
    }

    const newName = dto.name || oldName;
    const articles: Article[] = await this.getArticlesByTag(oldName, true);
    if (newName !== oldName) {
      for (const article of articles) {
        const newTags = [];
        if (article?.tags && article.tags.length > 0) {
          for (const tag of article.tags) {
            if (tag !== oldName) {
              newTags.push(tag);
            } else if (!article.tags.includes(newName)) {
              newTags.push(newName);
            }
          }
        }
        await this.articleProvider.updateById(article.id, { tags: newTags });
      }
    }

    const oldMeta: any = await this.tagModel.findOne({ name: oldName }).lean().exec();
    const targetMeta: any =
      newName === oldName ? oldMeta : await this.tagModel.findOne({ name: newName }).lean().exec();
    const nameEn = Object.prototype.hasOwnProperty.call(dto, 'nameEn')
      ? dto.nameEn
      : targetMeta?.nameEn || oldMeta?.nameEn || '';
    await this.tagModel.updateOne(
      { name: newName },
      { $set: { name: newName, nameEn } },
      { upsert: true },
    );
    if (newName !== oldName) await this.tagModel.deleteOne({ name: oldName }).exec();
    return { message: '更新成功！', total: articles.length };
  }
  async deleteOne(name: string) {
    const articles = await this.getArticlesByTag(name, true);
    for (const article of articles) {
      const newTags = [];
      if (article?.tags && article.tags.length > 0) {
        for (const t of article?.tags) {
          if (t != name) {
            newTags.push(t);
          }
        }
      }
      await this.articleProvider.updateById(article.id, {
        tags: newTags,
      });
    }
    await this.tagModel.deleteOne({ name }).exec();
    return { message: '删除成功！', total: articles.length };
  }

  async exportForBackup(): Promise<TagDetail[]> {
    return this.getTagDetails(true);
  }

  async importFromBackup(tags: unknown): Promise<void> {
    if (tags === undefined || tags === null) return;
    if (!Array.isArray(tags)) throw new BadRequestException('Backup tags must be an array');
    for (const raw of tags) {
      const tag: TagDetail = typeof raw === 'string' ? { name: raw } : (raw as any);
      assertTextFields(
        tag as unknown as Record<string, unknown>,
        [
          { field: 'name', maxLength: 100, required: true },
          { field: 'nameEn', maxLength: LOCALIZED_NAME_MAX_LENGTH },
        ],
        'Backup tag',
      );
      const $set: Record<string, unknown> = { name: tag.name };
      if (Object.prototype.hasOwnProperty.call(tag, 'nameEn')) $set.nameEn = tag.nameEn;
      await this.tagModel.updateOne(
        { name: tag.name },
        { $set, $setOnInsert: { nameEn: '' } },
        { upsert: true },
      );
    }
  }
}
