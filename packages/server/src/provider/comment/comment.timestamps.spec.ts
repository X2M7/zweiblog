import { Connection, Model, Types, createConnection } from 'mongoose';
import { Comment, CommentSchema } from 'src/scheme/comment.schema';

describe('comment restore timestamp preservation', () => {
  let connection: Connection;
  let model: Model<Comment>;

  beforeAll(() => {
    connection = createConnection();
    model = connection.model('CommentTimestampSpec', CommentSchema.clone());
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await connection.destroy();
  });

  it('keeps exact backup timestamps after real Mongoose bulk-write casting', async () => {
    const createdAt = new Date('2020-01-02T03:04:05.000Z');
    const updatedAt = new Date('2021-02-03T04:05:06.000Z');
    const collectionBulkWrite = jest
      .spyOn(model.collection as any, 'bulkWrite')
      .mockImplementation((operations: any[], _options: unknown, callback: Function) => {
        callback(null, { acknowledged: true });
      });

    await model.bulkWrite([
      {
        updateOne: {
          filter: { _id: new Types.ObjectId() },
          update: {
            $set: {
              path: '/about',
              content: 'restored',
              nick: 'Alice',
              mail: '',
              link: '',
              parentId: null,
              rootId: null,
              status: 'approved',
              likes: 0,
              isAdmin: false,
              createdAt,
              updatedAt,
            },
          },
          upsert: true,
          timestamps: false,
        },
      },
    ]);

    const castOperation = collectionBulkWrite.mock.calls[0][0][0].updateOne;
    expect(castOperation.timestamps).toBe(false);
    // Mongoose moves immutable createdAt to $setOnInsert for upserts, but the
    // original value must survive casting instead of being replaced with now.
    expect(castOperation.update.$set.createdAt).toBeUndefined();
    expect(castOperation.update.$setOnInsert.createdAt).toEqual(createdAt);
    expect(castOperation.update.$set.updatedAt).toEqual(updatedAt);
  });

  it('does not inject a competing $set.updatedAt into legacy upserts', async () => {
    const createdAt = new Date('2020-01-02T03:04:05.000Z');
    const updatedAt = new Date('2021-02-03T04:05:06.000Z');
    const collectionUpdateOne = jest
      .spyOn(model.collection as any, 'updateOne')
      .mockResolvedValue({ acknowledged: true, matchedCount: 0, modifiedCount: 0 });

    await model
      .updateOne(
        { legacyId: 'waline-id' },
        {
          $setOnInsert: {
            legacyId: 'waline-id',
            path: '/about',
            content: 'migrated',
            nick: 'Alice',
            parentId: null,
            rootId: null,
            status: 'approved',
            createdAt,
            updatedAt,
          },
        },
        { upsert: true, timestamps: false },
      )
      .exec();

    const castUpdate = collectionUpdateOne.mock.calls[0][1] as any;
    expect(castUpdate.$set).toBeUndefined();
    expect(castUpdate.$setOnInsert.createdAt).toEqual(createdAt);
    expect(castUpdate.$setOnInsert.updatedAt).toEqual(updatedAt);
  });
});
