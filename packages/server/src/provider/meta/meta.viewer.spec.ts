import { MetaProvider } from './meta.provider';

function deferred() {
  let resolve: (value?: unknown) => void;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve: (value?: unknown) => resolve(value) };
}

function makeProvider() {
  const visitProvider: any = { add: jest.fn().mockResolvedValue(undefined) };
  const viewProvider: any = { createOrUpdate: jest.fn().mockResolvedValue(undefined) };
  const articleProvider: any = {
    updateViewerByPathname: jest.fn().mockResolvedValue(undefined),
    updateViewer: jest.fn().mockResolvedValue(undefined),
  };
  const metaModel: any = {
    findOneAndUpdate: jest.fn((_query, update) => ({
      exec: jest.fn().mockResolvedValue({ viewer: 11, visited: 4 + update.$inc.visited }),
    })),
  };
  const provider = new MetaProvider(
    metaModel,
    {} as any,
    visitProvider,
    viewProvider,
    articleProvider,
  );
  jest.spyOn(provider, 'getAll').mockResolvedValue({ viewer: 10, visited: 4 } as any);
  jest.spyOn(provider, 'update').mockResolvedValue(undefined);
  return { provider, visitProvider, viewProvider, articleProvider, metaModel };
}

describe('pageview write completion', () => {
  it.each(['path', 'daily'])(
    'waits for both records when the %s write finishes first',
    async (first) => {
      const { provider, visitProvider, viewProvider } = makeProvider();
      const pathWrite = deferred();
      const dailyWrite = deferred();
      const writesStarted = deferred();
      visitProvider.add.mockImplementation(() => {
        writesStarted.resolve();
        return pathWrite.promise;
      });
      viewProvider.createOrUpdate.mockReturnValue(dailyWrite.promise);
      let completed = false;
      const response = provider.addViewer(true, '/post/example', true).then((data) => {
        completed = true;
        return data;
      });

      await writesStarted.promise;
      expect(completed).toBe(false);
      const firstWrite = first === 'path' ? pathWrite : dailyWrite;
      const lastWrite = first === 'path' ? dailyWrite : pathWrite;
      firstWrite.resolve();
      await firstWrite.promise;
      expect(completed).toBe(false);
      lastWrite.resolve();

      await expect(response).resolves.toEqual({ viewer: 11, visited: 5 });
      expect(completed).toBe(true);
    },
  );

  it.each(['path', 'daily'])(
    'propagates a failed %s write instead of returning success',
    async (kind) => {
      const { provider, visitProvider, viewProvider } = makeProvider();
      const failure = new Error(`${kind} write failed`);
      const write = kind === 'path' ? visitProvider.add : viewProvider.createOrUpdate;
      write.mockRejectedValue(failure);

      await expect(provider.addViewer(false, '/post/example', false)).rejects.toBe(failure);
      expect(visitProvider.add).toHaveBeenCalledTimes(1);
      expect(viewProvider.createOrUpdate).toHaveBeenCalledTimes(1);
    },
  );

  it.each([true, false])(
    'increments once while retaining unique-visitor semantics (new=%s)',
    async (isNew) => {
      const { provider, visitProvider, viewProvider, articleProvider, metaModel } = makeProvider();
      const expected = { viewer: 11, visited: isNew ? 5 : 4 };

      await expect(provider.addViewer(isNew, '/post/example', isNew)).resolves.toEqual(expected);

      expect(metaModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
      expect(metaModel.findOneAndUpdate).toHaveBeenCalledWith(
        {},
        { $inc: { viewer: 1, visited: isNew ? 1 : 0 } },
        { new: true },
      );
      expect(articleProvider.updateViewerByPathname).toHaveBeenCalledTimes(1);
      expect(articleProvider.updateViewerByPathname).toHaveBeenCalledWith('example', isNew);
      expect(visitProvider.add).toHaveBeenCalledTimes(1);
      expect(visitProvider.add).toHaveBeenCalledWith({ pathname: '/post/example', isNew });
      expect(viewProvider.createOrUpdate).toHaveBeenCalledTimes(1);
      expect(viewProvider.createOrUpdate).toHaveBeenCalledWith({
        date: expect.any(String),
        ...expected,
      });
    },
  );
});

describe('resolved article pageviews', () => {
  it('updates the resolved numeric article once without reinterpreting it as another slug', async () => {
    const { provider, articleProvider, visitProvider } = makeProvider();
    const seed = { viewer: 10, visited: 4, aliases: ['/post/example'] };
    await provider.addViewer(false, '/post/7', false, seed);
    expect(articleProvider.updateViewer).toHaveBeenCalledWith(7, false);
    expect(articleProvider.updateViewer).toHaveBeenCalledTimes(1);
    expect(articleProvider.updateViewerByPathname).not.toHaveBeenCalled();
    expect(visitProvider.add).toHaveBeenCalledWith({ pathname: '/post/7', isNew: false, seed });
  });
});
