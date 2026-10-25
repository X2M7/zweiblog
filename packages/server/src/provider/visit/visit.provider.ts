import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import dayjs from 'dayjs';
import { Model, Types } from 'mongoose';
import { createHash } from 'node:crypto';
import { createVisitDto, VisitSeed } from 'src/types/visit.dto';
import { Visit } from 'src/scheme/visit.schema';
import { VisitDocument } from 'src/scheme/visit.schema';

@Injectable()
export class VisitProvider {
  constructor(@InjectModel('Visit') private visitModel: Model<VisitDocument>) {}

  private async seedFor(pathname: string, seed?: VisitSeed) {
    const aliases = [...new Set([pathname, `/en${pathname}`, ...(seed?.aliases || [])])];
    const history = await Promise.all(aliases.map((alias) => this.getLastData(alias)));
    const viewer = history.reduce((sum, row) => sum + Math.max(0, Number(row?.viewer) || 0), 0);
    const visited = history.reduce((sum, row) => sum + Math.max(0, Number(row?.visited) || 0), 0);
    return {
      viewer: Math.max(viewer, seed?.viewer || 0),
      visited: Math.max(visited, seed?.visited || 0),
      hasHistory: history.some(Boolean),
    };
  }

  async add({ isNew, pathname, seed }: createVisitDto): Promise<any> {
    const query = { pathname, aggregate: true };
    const update = {
      $inc: { viewer: 1, visited: isNew ? 1 : 0 },
      $set: { date: dayjs().format('YYYY-MM-DD'), lastVisitedTime: new Date() },
    };
    const existing = await this.visitModel.findOneAndUpdate(query, update, { new: true }).exec();
    if (existing) return existing;

    const initial = await this.seedFor(pathname, seed);
    // A partial unique index guarantees one cumulative record per real path.
    // Initialize legacy aliases only once; later requests increment atomically.
    // The deterministic _id also protects concurrent startup requests while
    // MongoDB is still building the secondary index.
    const _id = new Types.ObjectId(
      createHash('sha256').update(`visit:${pathname}`).digest('hex').slice(0, 24),
    );
    try {
      return await this.visitModel
        .findOneAndUpdate(
          { ...query, _id },
          [
            {
              $set: {
                pathname: { $literal: pathname },
                aggregate: true,
                viewer: { $add: [{ $ifNull: ['$viewer', initial.viewer] }, 1] },
                visited: { $add: [{ $ifNull: ['$visited', initial.visited] }, isNew ? 1 : 0] },
                date: dayjs().format('YYYY-MM-DD'),
                lastVisitedTime: new Date(),
                createdAt: { $ifNull: ['$createdAt', new Date()] },
              },
            },
          ],
          { upsert: true, new: true },
        )
        .exec();
    } catch (error: any) {
      if (error?.code !== 11000) throw error;
      return this.visitModel.findOneAndUpdate(query, update, { new: true }).exec();
    }
  }

  async rewriteToday(pathname: string, viewer: number, visited: number) {
    return this.visitModel
      .findOneAndUpdate(
        { pathname, aggregate: true },
        { $set: { date: dayjs().format('YYYY-MM-DD'), viewer, visited } },
        { upsert: true, new: true },
      )
      .exec();
  }

  async getLastData(pathname: string) {
    const lastData = await this.visitModel
      .find({ pathname })
      .sort({ aggregate: -1, date: -1 })
      .limit(1);
    return lastData?.[0] || null;
  }

  async getAll(): Promise<Visit[]> {
    return this.visitModel.find({}).exec();
  }

  async findByDateAndPath(date: string, pathname: string): Promise<Visit> {
    return this.visitModel.findOne({ date, pathname }).exec();
  }
  async getByArticleId(
    id: number | string,
    article?: { pathname?: string; viewer?: number; visited?: number },
  ) {
    const pathname = id == 0 ? '/about' : `/post/${id}`;
    const latest = await this.getLastData(pathname);
    if (latest?.aggregate) return latest;
    const { hasHistory, ...counts } = await this.seedFor(pathname, {
      viewer: article?.viewer || 0,
      visited: article?.visited || 0,
      aliases: article?.pathname
        ? [`/post/${article.pathname}`, `/en/post/${article.pathname}`]
        : [],
    });
    return hasHistory || article ? { pathname, ...counts } : null;
  }
  async getLastVisitItem() {
    const result = await this.visitModel
      .find({
        lastVisitedTime: { $exists: true },
      })
      .sort({ lastVisitedTime: -1 })
      .limit(1);
    if (result && result.length) {
      return result[0];
    }
    return null;
  }

  async import(data: Visit[]) {
    for (const each of data) {
      const oldData = await this.visitModel.findOne({
        pathname: each.pathname,
        ...(each.aggregate ? { aggregate: true } : { date: each.date, aggregate: { $ne: true } }),
      });
      if (oldData) {
        await this.visitModel.updateOne({ _id: oldData._id }, each);
      } else {
        const newData = new this.visitModel(each);
        await newData.save();
      }
    }
  }
}
