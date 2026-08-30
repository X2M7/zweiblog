import { buildPublicCommentTree, serializePublicComment } from './commentPublic';

describe('public comment serialization', () => {
  it('uses an explicit public allowlist and never emits private metadata', () => {
    const result = serializePublicComment({
      _id: 'root',
      path: '/post/1',
      content: 'hello',
      nick: 'Alice',
      mail: 'private@example.com',
      ip: '203.0.113.1',
      ua: 'private-agent',
      location: '中国 上海市',
      browser: 'Chrome 140',
      os: 'Windows 11',
      status: 'approved',
    });
    expect(result).toMatchObject({
      location: '中国 上海市',
      browser: 'Chrome 140',
      os: 'Windows 11',
    });
    expect(result).not.toHaveProperty('mail');
    expect(result).not.toHaveProperty('ip');
    expect(result).not.toHaveProperty('ua');
  });

  it('allows 50,000 characters and truncates a 50,001-character legacy value', () => {
    const result = serializePublicComment({
      _id: 'long',
      path: '/post/1',
      content: 'x'.repeat(50_001),
      nick: 'Alice',
      status: 'approved',
    });
    expect(result.content).toHaveLength(50_000);
    expect(result.content).toBe('x'.repeat(50_000));
    expect(result.contentTruncated).toBe(true);

    const exact = serializePublicComment({
      _id: 'exact',
      path: '/post/1',
      content: 'x'.repeat(50_000),
      nick: 'Alice',
      status: 'approved',
    });
    expect(exact.content).toHaveLength(50_000);
    expect(exact).not.toHaveProperty('contentTruncated');
  });

  it('builds nested reply threads and supplies replyToNick', () => {
    const [root] = buildPublicCommentTree(
      [{ _id: 'root', path: '/post/1', content: 'root', nick: 'Alice' }],
      [
        {
          _id: 'child',
          rootId: 'root',
          parentId: 'root',
          path: '/post/1',
          content: 'child',
          nick: 'Bob',
        },
        {
          _id: 'grandchild',
          rootId: 'root',
          parentId: 'child',
          path: '/post/1',
          content: 'grandchild',
          nick: 'Carol',
        },
      ],
    );
    expect(root.replies[0].replyToNick).toBe('Alice');
    expect(root.replies[0].replies[0].replyToNick).toBe('Bob');
  });

  it('masks a soft-deleted reply while preserving its place in a thread', () => {
    const result = serializePublicComment({
      _id: 'deleted',
      path: '/post/1',
      content: 'private old content',
      nick: 'Alice',
      link: 'https://example.com',
      likes: 10,
      location: '中国 上海市',
      browser: 'Chrome 140',
      os: 'Windows 11',
      status: 'deleted',
    });
    expect(result).toMatchObject({
      content: '该评论已删除',
      nick: '',
      link: '',
      likes: 0,
      location: '',
      browser: '',
      os: '',
      deleted: true,
    });
  });

  it('removes deleted leaves but keeps a deleted bridge to a visible reply', () => {
    const [root] = buildPublicCommentTree(
      [{ _id: 'root', path: '/post/1', content: 'root', nick: 'Alice' }],
      [
        {
          _id: 'leaf',
          rootId: 'root',
          parentId: 'root',
          path: '/post/1',
          status: 'deleted',
        },
        {
          _id: 'bridge',
          rootId: 'root',
          parentId: 'root',
          path: '/post/1',
          status: 'deleted',
        },
        {
          _id: 'visible',
          rootId: 'root',
          parentId: 'bridge',
          path: '/post/1',
          content: 'still here',
          nick: 'Bob',
          status: 'approved',
        },
      ],
    );
    expect(root.replies.map((reply) => reply.id)).toEqual(['bridge']);
    expect(root.replies[0].replies[0].id).toBe('visible');
  });

  it('drops cyclic, orphaned and over-depth reply branches', () => {
    const [root] = buildPublicCommentTree(
      [{ _id: 'root', path: '/post/1', content: 'root', nick: 'Alice' }],
      [
        { _id: 'one', rootId: 'root', parentId: 'root', content: '1', nick: '1' },
        { _id: 'two', rootId: 'root', parentId: 'one', content: '2', nick: '2' },
        { _id: 'three', rootId: 'root', parentId: 'two', content: '3', nick: '3' },
        { _id: 'cycle-a', rootId: 'root', parentId: 'cycle-b', content: 'a', nick: 'a' },
        { _id: 'cycle-b', rootId: 'root', parentId: 'cycle-a', content: 'b', nick: 'b' },
      ],
      2,
    );
    expect(root.replies[0].replies[0].id).toBe('two');
    expect(root.replies[0].replies[0].replies).toEqual([]);
  });

  it('never promotes a reply whose direct parent is hidden', () => {
    const [root] = buildPublicCommentTree(
      [{ _id: 'root', path: '/post/1', content: 'root', nick: 'Alice' }],
      [
        {
          _id: 'approved-grandchild',
          rootId: 'root',
          parentId: 'pending-parent-not-in-public-query',
          path: '/post/1',
          content: 'must not float to root',
          nick: 'Mallory',
          status: 'approved',
        },
      ],
    );
    expect(root.replies).toEqual([]);
  });
});
