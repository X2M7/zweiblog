import { createConnection, Connection } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { VisitProvider } from './visit.provider';
import { VisitSchema } from 'src/scheme/visit.schema';
import { ViewerSchema } from 'src/scheme/viewer.schema';
import { MetaSchema } from 'src/scheme/meta.schema';
import { ArticleSchema } from 'src/scheme/article.schema';
import { ViewerProvider } from '../viewer/viewer.provider';
import { MetaProvider } from '../meta/meta.provider';
import { ArticleProvider } from '../article/article.provider';

// Opt-in real database checks always create and drop their own isolated database.
const describeMongo = process.env.ZWEIBLOG_TEST_MONGO_URI ? describe : describe.skip;
describeMongo('cumulative visits with real MongoDB', () => {
  let connection: Connection;
  let model: any;
  let provider: VisitProvider;
  beforeAll(async () => {
    connection = await createConnection(process.env.ZWEIBLOG_TEST_MONGO_URI, {
      dbName: `zweiblog_security_test_${randomUUID().replace(/-/g, '')}`,
      serverSelectionTimeoutMS: 5000,
    }).asPromise();
    model = connection.model('Visit', VisitSchema);
    await model.init();
    provider = new VisitProvider(model);
  });
  beforeEach(async () => {
    await model.deleteMany({});
  });
  afterAll(async () => {
    if (connection) {
      await connection.dropDatabase();
      await connection.close();
    }
  });
  it('preserves legacy aliases and increments exactly once under concurrent first visits', async () => {
    await model.insertMany([
      { pathname: '/post/7', date: '2020-01-01', viewer: 10, visited: 5 },
      { pathname: '/post/7', date: '2020-01-02', viewer: 12, visited: 6 },
      { pathname: '/post/slug', date: '2020-01-02', viewer: 20, visited: 10 },
      { pathname: '/en/post/slug', date: '2020-01-02', viewer: 5, visited: 3 },
    ]);
    const seed = { viewer: 40, visited: 20, aliases: ['/post/slug', '/en/post/slug'] };
    await Promise.all(
      Array.from({ length: 25 }, () => provider.add({ pathname: '/post/7', isNew: true, seed })),
    );
    const rows = await model.find({ aggregate: true }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ pathname: '/post/7', viewer: 65, visited: 45 });
    expect(await model.countDocuments({ aggregate: { $ne: true } })).toBe(4);
    expect(
      await provider.getByArticleId(7, { pathname: 'slug', viewer: 65, visited: 45 }),
    ).toMatchObject({ viewer: 65, visited: 45 });
  });
  it('reads a combined legacy count before the first aggregate write without modifying history', async () => {
    await model.insertMany([
      { pathname: '/post/7', date: '2020-01-01', viewer: 4, visited: 2 },
      { pathname: '/post/slug', date: '2020-01-01', viewer: 6, visited: 3 },
    ]);
    await expect(
      provider.getByArticleId(7, { pathname: 'slug', viewer: 10, visited: 5 }),
    ).resolves.toMatchObject({ viewer: 10, visited: 5 });
    expect(await model.countDocuments({})).toBe(2);
  });
  it('updates the same cumulative row across dates and does not reset returning visitors', async () => {
    await model.create({
      pathname: '/about',
      aggregate: true,
      date: '2020-01-01',
      viewer: 50,
      visited: 20,
    });
    await Promise.all(
      Array.from({ length: 12 }, () => provider.add({ pathname: '/about', isNew: false })),
    );
    expect(await model.countDocuments({})).toBe(1);
    await expect(provider.getByArticleId(0)).resolves.toMatchObject({ viewer: 62, visited: 20 });
  });
  it('keeps site, article, path and daily counters consistent under concurrent pageviews', async () => {
    const metaModel = connection.model('Meta', MetaSchema);
    const articleModel = connection.model('Article', ArticleSchema);
    const viewerModel = connection.model('Viewer', ViewerSchema);
    await Promise.all([metaModel.init(), articleModel.init(), viewerModel.init()]);
    await metaModel.create({ viewer: 40, visited: 20 });
    await articleModel.create({
      id: 7,
      pathname: 'slug',
      title: 'Counts',
      viewer: 40,
      visited: 20,
    });
    const articles = new ArticleProvider(articleModel, {} as any, {} as any, provider);
    const viewers = new ViewerProvider(viewerModel);
    const meta = new MetaProvider(metaModel, {} as any, provider, viewers, articles);
    const seed = { viewer: 40, visited: 20, aliases: ['/post/slug', '/en/post/slug'] };
    await Promise.all(
      Array.from({ length: 25 }, () => meta.addViewer(true, '/post/7', true, seed)),
    );
    expect(await meta.getViewer()).toEqual({ viewer: 65, visited: 45 });
    expect(await articleModel.findOne({ id: 7 })).toMatchObject({ viewer: 65, visited: 45 });
    expect(await provider.getByArticleId(7)).toMatchObject({ viewer: 65, visited: 45 });
    const daily = await viewerModel.find({}).lean();
    expect(daily).toHaveLength(1);
    expect(daily[0]).toMatchObject({ viewer: 65, visited: 45 });
    // Delayed lower snapshots cannot undo a newer count.
    await viewers.createOrUpdate({ date: daily[0].date, viewer: 42, visited: 21 });
    expect(await viewerModel.findOne({ date: daily[0].date })).toMatchObject({
      viewer: 65,
      visited: 45,
    });
  });
  it('keeps first visits unique even before the secondary index finishes building', async () => {
    await model.collection.dropIndex('visit_aggregate_path');
    try {
      await Promise.all(
        Array.from({ length: 20 }, () => provider.add({ pathname: '/tag/test', isNew: false })),
      );
      expect(await model.countDocuments({ pathname: '/tag/test' })).toBe(1);
      expect(await provider.getLastData('/tag/test')).toMatchObject({ viewer: 20, visited: 0 });
    } finally {
      await model.createIndexes();
    }
  });
});
