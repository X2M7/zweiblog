import { BadRequestException } from '@nestjs/common';
import { ArticleProvider } from './article.provider';

function setup() {
  const query: any = { then: (resolve: any) => Promise.resolve([]).then(resolve) };
  query.limit = jest.fn(() => query);
  query.maxTimeMS = jest.fn(() => query);
  query.exec = jest.fn().mockResolvedValue([]);
  const model: any = { find: jest.fn(() => query) };
  return {
    provider: new ArticleProvider(model, {} as any, {} as any, {} as any),
    model,
    query,
  };
}

describe('article link search security', () => {
  it.each(['(a+)+$', 'https://images.example/a.png?width=100&tag=[x]', '/static/img/a.webp'])(
    'matches %s literally instead of interpreting regex operators',
    async (link) => {
      const { provider, model, query } = setup();
      await provider.searchArticlesByLink(link);
      const conditions = model.find.mock.calls[0][0].$and[0].$or;
      for (const condition of conditions) {
        const { $regex, $options } = Object.values(condition)[0] as any;
        const expression = new RegExp($regex, $options);
        expect(expression.test(`![image](${link})`)).toBe(true);
        expect(expression.test('aaaaaaa')).toBe(false);
      }
      expect(query.limit).toHaveBeenCalledWith(100);
      expect(query.maxTimeMS).toHaveBeenCalledWith(2_000);
    },
  );

  it.each([undefined, null, '', '   ', { $ne: null }, ['.*'], 'x'.repeat(2049)])(
    'rejects invalid input before touching the database: %j',
    async (link) => {
      const { provider, model } = setup();
      await expect(provider.searchArticlesByLink(link as any)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(model.find).not.toHaveBeenCalled();
    },
  );
});
