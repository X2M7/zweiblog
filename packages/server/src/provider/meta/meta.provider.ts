import { BadRequestException, forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Meta, MetaDocument } from 'src/scheme/meta.schema';
import { UpdateSiteInfoDto } from 'src/types/site.dto';
import { RewardItem } from 'src/types/reward.dto';
import {
  normalizeSocialDto,
  normalizeSocialTypeKey,
  SOCIAL_TYPE_OPTIONS,
  SocialItem,
  SocialType,
} from 'src/types/social.dto';
import { LinkItem, UpdateLinkPageDto } from 'src/types/link.dto';
import { UserProvider } from '../user/user.provider';
import { VisitProvider } from '../visit/visit.provider';
import { ArticleProvider } from '../article/article.provider';
import dayjs from 'dayjs';
import { isTrue } from 'src/utils/isTrue';
import { ViewerProvider } from '../viewer/viewer.provider';
import { UpdateAboutDto } from 'src/types/about.dto';
import {
  assertTextFields,
  LOCALIZED_CONTENT_MAX_LENGTH,
  LOCALIZED_DESCRIPTION_MAX_LENGTH,
  LOCALIZED_NAME_MAX_LENGTH,
  MENU_VALUE_MAX_LENGTH,
} from 'src/utils/localizedMetadata';
@Injectable()
export class MetaProvider {
  logger = new Logger(MetaProvider.name);
  timer = null;
  constructor(
    @InjectModel('Meta')
    private metaModel: Model<MetaDocument>,
    private readonly userProvider: UserProvider,
    private readonly visitProvider: VisitProvider,
    private readonly viewProvider: ViewerProvider,
    @Inject(forwardRef(() => ArticleProvider))
    private readonly articleProvider: ArticleProvider,
  ) {}

  async updateTotalWords(reason: string) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      const total = await this.articleProvider.countTotalWords();
      await this.update({ totalWordCount: total });
      this.logger.log(`${reason}触发更新字数缓存：当前文章总字数: ${total}`);
    }, 1000 * 30);
  }

  async getViewer() {
    const old = await this.getAll();
    const ov = old.viewer || 0;
    const oldVisited = old.visited || 0;
    const newViewer = ov;
    const newVisited = oldVisited;
    return { visited: newVisited, viewer: newViewer };
  }
  async addViewer(isNew: boolean, pathname: string, isNewByPath: boolean) {
    const old = await this.getAll();
    const ov = old.viewer || 0;
    const oldVisited = old.visited || 0;
    const newViewer = ov + 1;
    let newVisited = oldVisited;
    let isNewVisitorByArticle = false;
    if (isTrue(isNew)) {
      newVisited += 1;
    }
    if (isTrue(isNewByPath)) {
      isNewVisitorByArticle = true;
    }
    // 这个是 meta 的
    await this.update({
      viewer: newViewer,
      visited: newVisited,
    });
    // 更新文章的
    const r = /\/post\//;
    const isArticlePath = r.test(pathname);
    if (isArticlePath) {
      await this.articleProvider.updateViewerByPathname(
        pathname.replace('/post/', ''),
        isNewByPath,
      );
    }
    // 还需要增加每天的
    this.viewProvider.createOrUpdate({
      date: dayjs().format('YYYY-MM-DD'),
      viewer: newViewer,
      visited: newVisited,
    });
    //增加每个路径的。
    this.visitProvider.add({
      pathname: pathname,
      isNew: isNewVisitorByArticle,
    });
    return { visited: newVisited, viewer: newViewer };
  }

  async getAll() {
    return this.metaModel.findOne().exec();
  }

  async getSocialTypes() {
    return SOCIAL_TYPE_OPTIONS;
  }
  async getTotalWords() {
    return (await this.getAll()).totalWordCount || 0;
  }

  async update(updateMetaDto: Partial<Meta>) {
    const update: Record<string, any> = { ...(updateMetaDto as any) };
    if (Object.prototype.hasOwnProperty.call(update, 'siteInfo')) {
      if (
        !update.siteInfo ||
        typeof update.siteInfo !== 'object' ||
        Array.isArray(update.siteInfo)
      ) {
        throw new BadRequestException('Site info must be an object');
      }
      const current = await this.getSiteInfo();
      const incoming = { ...update.siteInfo };
      if (
        !Object.prototype.hasOwnProperty.call(incoming, 'authorDesc') &&
        Object.prototype.hasOwnProperty.call(incoming, 'authDesc')
      ) {
        incoming.authorDesc = incoming.authDesc;
      }
      delete incoming.authDesc;
      for (const field of ['authorEn', 'authorDescEn', 'siteNameEn', 'siteDescEn']) {
        if (!Object.prototype.hasOwnProperty.call(incoming, field))
          incoming[field] = current[field];
      }
      assertTextFields(
        incoming,
        [
          { field: 'author', maxLength: LOCALIZED_NAME_MAX_LENGTH },
          { field: 'authorEn', maxLength: LOCALIZED_NAME_MAX_LENGTH },
          { field: 'authorDesc', maxLength: LOCALIZED_DESCRIPTION_MAX_LENGTH },
          { field: 'authorDescEn', maxLength: LOCALIZED_DESCRIPTION_MAX_LENGTH },
          { field: 'siteName', maxLength: LOCALIZED_NAME_MAX_LENGTH },
          { field: 'siteNameEn', maxLength: LOCALIZED_NAME_MAX_LENGTH },
          { field: 'siteDesc', maxLength: LOCALIZED_DESCRIPTION_MAX_LENGTH },
          { field: 'siteDescEn', maxLength: LOCALIZED_DESCRIPTION_MAX_LENGTH },
        ],
        'Site info',
      );
      update.siteInfo = incoming;
    }
    if (Object.prototype.hasOwnProperty.call(update, 'about')) {
      if (!update.about || typeof update.about !== 'object' || Array.isArray(update.about)) {
        throw new BadRequestException('About must be an object');
      }
      const current = await this.getAbout();
      const incoming = { ...update.about };
      if (!Object.prototype.hasOwnProperty.call(incoming, 'contentEn')) {
        incoming.contentEn = current.contentEn;
      }
      assertTextFields(
        incoming,
        [
          { field: 'content', maxLength: LOCALIZED_CONTENT_MAX_LENGTH },
          { field: 'contentEn', maxLength: LOCALIZED_CONTENT_MAX_LENGTH },
        ],
        'About',
      );
      update.about = incoming;
    }
    if (Object.prototype.hasOwnProperty.call(update, 'linkPage')) {
      if (
        !update.linkPage ||
        typeof update.linkPage !== 'object' ||
        Array.isArray(update.linkPage)
      ) {
        throw new BadRequestException('Link page must be an object');
      }
      const current = await this.getLinkPage();
      const incoming = { ...update.linkPage };
      for (const field of ['content', 'contentEn']) {
        if (!Object.prototype.hasOwnProperty.call(incoming, field)) {
          incoming[field] = current[field];
        }
      }
      if (!Object.prototype.hasOwnProperty.call(incoming, 'updatedAt')) {
        incoming.updatedAt = current.updatedAt;
      }
      assertTextFields(
        incoming,
        [
          { field: 'content', maxLength: LOCALIZED_CONTENT_MAX_LENGTH },
          { field: 'contentEn', maxLength: LOCALIZED_CONTENT_MAX_LENGTH },
        ],
        'Link page',
      );
      update.linkPage = incoming;
    }
    if (Object.prototype.hasOwnProperty.call(update, 'links')) {
      if (!Array.isArray(update.links)) throw new BadRequestException('Links must be an array');
      const current = await this.getLinks();
      update.links = update.links.map((raw: unknown) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          throw new BadRequestException('Link must be an object');
        }
        const incoming = { ...(raw as Record<string, unknown>) };
        const old = current.find((item) => item.name === incoming.name);
        for (const field of ['nameEn', 'descEn']) {
          if (!Object.prototype.hasOwnProperty.call(incoming, field)) {
            incoming[field] = (old as any)?.[field] || '';
          }
        }
        assertTextFields(
          incoming,
          [
            { field: 'name', maxLength: LOCALIZED_NAME_MAX_LENGTH, required: true },
            { field: 'nameEn', maxLength: LOCALIZED_NAME_MAX_LENGTH },
            { field: 'desc', maxLength: LOCALIZED_DESCRIPTION_MAX_LENGTH },
            { field: 'descEn', maxLength: LOCALIZED_DESCRIPTION_MAX_LENGTH },
            { field: 'url', maxLength: MENU_VALUE_MAX_LENGTH },
            { field: 'logo', maxLength: MENU_VALUE_MAX_LENGTH },
          ],
          'Link',
        );
        return incoming;
      });
    }
    return this.metaModel.updateOne({}, update);
  }
  async getAbout() {
    const about: any = (await this.getAll())?.about;
    const raw = typeof about?.toObject === 'function' ? about.toObject() : { ...(about || {}) };
    return {
      updatedAt: raw.updatedAt,
      content: typeof raw.content === 'string' ? raw.content : '',
      contentEn: typeof raw.contentEn === 'string' ? raw.contentEn : '',
    };
  }
  async getSiteInfo() {
    const siteInfo: any = (await this.getAll())?.siteInfo;
    const raw =
      typeof siteInfo?.toObject === 'function' ? siteInfo.toObject() : { ...(siteInfo || {}) };
    return {
      ...raw,
      authorDesc:
        typeof raw.authorDesc === 'string'
          ? raw.authorDesc
          : typeof raw.authDesc === 'string'
            ? raw.authDesc
            : '',
      authorEn: typeof raw.authorEn === 'string' ? raw.authorEn : '',
      authorDescEn: typeof raw.authorDescEn === 'string' ? raw.authorDescEn : '',
      siteNameEn: typeof raw.siteNameEn === 'string' ? raw.siteNameEn : '',
      siteDescEn: typeof raw.siteDescEn === 'string' ? raw.siteDescEn : '',
    };
  }
  async getRewards() {
    return (await this.getAll())?.rewards;
  }
  async getSocials() {
    const socials = (await this.getAll())?.socials;
    return Array.isArray(socials) ? socials : [];
  }
  async getLinks() {
    const links = (await this.getAll())?.links || [];
    return links.map((link: any) => {
      const raw = typeof link?.toObject === 'function' ? link.toObject() : { ...(link || {}) };
      return {
        ...raw,
        nameEn: typeof raw.nameEn === 'string' ? raw.nameEn : '',
        descEn: typeof raw.descEn === 'string' ? raw.descEn : '',
      };
    });
  }

  async getLinkPage() {
    const linkPage: any = (await this.getAll())?.linkPage;
    const raw =
      typeof linkPage?.toObject === 'function' ? linkPage.toObject() : { ...(linkPage || {}) };
    return {
      updatedAt: raw.updatedAt,
      content: typeof raw.content === 'string' ? raw.content : '',
      contentEn: typeof raw.contentEn === 'string' ? raw.contentEn : '',
    };
  }

  async updateAbout(update: UpdateAboutDto | string) {
    const dto: UpdateAboutDto = typeof update === 'string' ? { content: update } : { ...update };
    assertTextFields(
      dto as Record<string, unknown>,
      [
        { field: 'content', maxLength: LOCALIZED_CONTENT_MAX_LENGTH },
        { field: 'contentEn', maxLength: LOCALIZED_CONTENT_MAX_LENGTH },
      ],
      'About',
    );
    if (
      !Object.prototype.hasOwnProperty.call(dto, 'content') &&
      !Object.prototype.hasOwnProperty.call(dto, 'contentEn')
    ) {
      throw new BadRequestException('About update requires content or contentEn');
    }
    const $set: Record<string, unknown> = { 'about.updatedAt': new Date() };
    if (Object.prototype.hasOwnProperty.call(dto, 'content')) $set['about.content'] = dto.content;
    if (Object.prototype.hasOwnProperty.call(dto, 'contentEn')) {
      $set['about.contentEn'] = dto.contentEn;
    }
    return this.metaModel.updateOne({}, { $set });
  }

  async updateLinkPage(update: UpdateLinkPageDto | string) {
    const dto: UpdateLinkPageDto =
      typeof update === 'string' ? { content: update } : { ...(update || {}) };
    assertTextFields(
      dto as Record<string, unknown>,
      [
        { field: 'content', maxLength: LOCALIZED_CONTENT_MAX_LENGTH },
        { field: 'contentEn', maxLength: LOCALIZED_CONTENT_MAX_LENGTH },
      ],
      'Link page',
    );
    if (
      !Object.prototype.hasOwnProperty.call(dto, 'content') &&
      !Object.prototype.hasOwnProperty.call(dto, 'contentEn')
    ) {
      throw new BadRequestException('Link page update requires content or contentEn');
    }
    const $set: Record<string, unknown> = { 'linkPage.updatedAt': new Date() };
    if (Object.prototype.hasOwnProperty.call(dto, 'content')) {
      $set['linkPage.content'] = dto.content;
    }
    if (Object.prototype.hasOwnProperty.call(dto, 'contentEn')) {
      $set['linkPage.contentEn'] = dto.contentEn;
    }
    return this.metaModel.updateOne({}, { $set });
  }

  async updateSiteInfo(updateSiteInfoDto: UpdateSiteInfoDto) {
    // @ts-ignore eslint-disable-next-line @typescript-eslint/ban-ts-comment
    const { name, password, ...incoming } = updateSiteInfoDto as any;
    const updateDto: Record<string, unknown> = { ...incoming };
    if (
      !Object.prototype.hasOwnProperty.call(updateDto, 'authorDesc') &&
      Object.prototype.hasOwnProperty.call(updateDto, 'authDesc')
    ) {
      updateDto.authorDesc = updateDto.authDesc;
    }
    delete updateDto.authDesc;
    assertTextFields(
      updateDto,
      [
        { field: 'author', maxLength: LOCALIZED_NAME_MAX_LENGTH },
        { field: 'authorEn', maxLength: LOCALIZED_NAME_MAX_LENGTH },
        { field: 'authorDesc', maxLength: LOCALIZED_DESCRIPTION_MAX_LENGTH },
        { field: 'authorDescEn', maxLength: LOCALIZED_DESCRIPTION_MAX_LENGTH },
        { field: 'siteName', maxLength: LOCALIZED_NAME_MAX_LENGTH },
        { field: 'siteNameEn', maxLength: LOCALIZED_NAME_MAX_LENGTH },
        { field: 'siteDesc', maxLength: LOCALIZED_DESCRIPTION_MAX_LENGTH },
        { field: 'siteDescEn', maxLength: LOCALIZED_DESCRIPTION_MAX_LENGTH },
      ],
      'Site info',
    );
    const oldSiteInfo = await this.getSiteInfo();
    return this.metaModel.updateOne({}, { siteInfo: { ...oldSiteInfo, ...updateDto } });
  }

  async addOrUpdateReward(addReward: Partial<RewardItem>) {
    const meta = await this.getAll();
    const toAdd: RewardItem = {
      updatedAt: new Date(),
      value: addReward.value,
      name: addReward.name,
    };
    const newRewards = [];
    let pushed = false;

    meta.rewards.forEach((r) => {
      if (r.name === toAdd.name) {
        pushed = true;
        newRewards.push(toAdd);
      } else {
        newRewards.push(r);
      }
    });
    if (!pushed) {
      newRewards.push(toAdd);
    }

    return this.metaModel.updateOne({}, { rewards: newRewards });
  }

  async deleteReward(name: string) {
    const meta = await this.getAll();
    const newRewards = [];
    meta.rewards.forEach((r) => {
      if (r.name !== name) {
        newRewards.push(r);
      }
    });
    return this.metaModel.updateOne({}, { rewards: newRewards });
  }

  async deleteSocial(type: string) {
    // Allow administrators to remove an unknown type left by an older version,
    // while still rejecting malformed path keys.
    const normalizedType = normalizeSocialTypeKey(type);
    const meta = await this.getAll();
    const socials = Array.isArray(meta?.socials) ? meta.socials : [];
    const newSocials = [];
    socials.forEach((r) => {
      if (r.type !== normalizedType) {
        newSocials.push(r);
      }
    });
    return this.metaModel.updateOne({}, { socials: newSocials });
  }

  async addOrUpdateSocial(addSocial: Partial<SocialItem>) {
    const normalized = normalizeSocialDto(addSocial);
    const meta = await this.getAll();
    const toAdd: SocialItem = {
      updatedAt: new Date(),
      value: normalized.value,
      type: normalized.type,
    };
    const newSocials = [];
    let pushed = false;
    const socials = Array.isArray(meta?.socials) ? meta.socials : [];
    socials.forEach((r) => {
      if (r.type === toAdd.type) {
        if (!pushed) {
          pushed = true;
          newSocials.push(toAdd);
        }
      } else {
        newSocials.push(r);
      }
    });
    if (!pushed) {
      newSocials.push(toAdd);
    }

    return this.metaModel.updateOne({}, { socials: newSocials });
  }
  async addOrUpdateLink(addLinkDto: Partial<LinkItem>) {
    assertTextFields(
      addLinkDto as Record<string, unknown>,
      [
        { field: 'name', maxLength: LOCALIZED_NAME_MAX_LENGTH, required: true },
        { field: 'nameEn', maxLength: LOCALIZED_NAME_MAX_LENGTH },
        { field: 'desc', maxLength: LOCALIZED_DESCRIPTION_MAX_LENGTH, required: true },
        { field: 'descEn', maxLength: LOCALIZED_DESCRIPTION_MAX_LENGTH },
        { field: 'url', maxLength: MENU_VALUE_MAX_LENGTH, required: true },
        { field: 'logo', maxLength: MENU_VALUE_MAX_LENGTH, required: true },
      ],
      'Link',
    );
    const meta = await this.getAll();
    const newLinks = [];
    let pushed = false;

    (meta.links || []).forEach((r: any) => {
      if (r.name === addLinkDto.name) {
        pushed = true;
        newLinks.push({
          ...(typeof r?.toObject === 'function' ? r.toObject() : r),
          updatedAt: new Date(),
          url: addLinkDto.url,
          name: addLinkDto.name,
          desc: addLinkDto.desc,
          logo: addLinkDto.logo,
          nameEn: Object.prototype.hasOwnProperty.call(addLinkDto, 'nameEn')
            ? addLinkDto.nameEn
            : r.nameEn || '',
          descEn: Object.prototype.hasOwnProperty.call(addLinkDto, 'descEn')
            ? addLinkDto.descEn
            : r.descEn || '',
        });
      } else {
        newLinks.push(r);
      }
    });
    if (!pushed) {
      newLinks.push({
        updatedAt: new Date(),
        url: addLinkDto.url,
        name: addLinkDto.name,
        nameEn: addLinkDto.nameEn || '',
        desc: addLinkDto.desc,
        descEn: addLinkDto.descEn || '',
        logo: addLinkDto.logo,
      });
    }

    return this.metaModel.updateOne({}, { links: newLinks });
  }

  async reorderLinks(names: unknown) {
    if (!Array.isArray(names)) {
      throw new BadRequestException('Link order names must be an array');
    }
    if (names.some((name) => typeof name !== 'string')) {
      throw new BadRequestException('Every link order name must be a string');
    }
    const uniqueNames = new Set(names);
    if (uniqueNames.size !== names.length) {
      throw new BadRequestException('Link order names must not contain duplicates');
    }

    const meta = await this.getAll();
    const links: any[] = Array.isArray(meta?.links) ? [...meta.links] : [];
    const linksByName = new Map<string, any>();
    for (const link of links) {
      if (typeof link?.name !== 'string' || linksByName.has(link.name)) {
        throw new BadRequestException('Existing links do not have unique valid names');
      }
      linksByName.set(link.name, link);
    }

    if (names.length !== links.length) {
      throw new BadRequestException('Link order must include every existing link exactly once');
    }
    for (const name of names) {
      if (!linksByName.has(name)) {
        throw new BadRequestException(`Unknown link name: ${name}`);
      }
    }

    return this.metaModel.updateOne({}, { links: names.map((name) => linksByName.get(name)) });
  }

  async deleteLink(name: string) {
    const meta = await this.getAll();
    const newLinks = [];
    meta.links.forEach((r) => {
      if (r.name !== name) {
        newLinks.push(r);
      }
    });
    return this.metaModel.updateOne({}, { links: newLinks });
  }
}
