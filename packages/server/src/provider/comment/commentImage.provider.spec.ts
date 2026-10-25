import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { config } from 'src/config';
import { CommentImageProvider } from './commentImage.provider';

describe('comment image storage lifecycle', () => {
  let root: string;
  let original: string;
  let provider: CommentImageProvider;
  const name = `comment-${'a'.repeat(64)}.webp`;
  const uploads: any = {
    createIndex: jest.fn(),
    updateOne: jest.fn(),
    updateMany: jest.fn(),
    deleteOne: jest.fn(),
    find: jest.fn(),
  };
  const reference: any = { findOne: jest.fn() };
  const statics: any = { updateOne: jest.fn(), deleteOne: jest.fn() };
  const local: any = { saveImg: jest.fn() };
  const lease = { assertOwned: jest.fn().mockResolvedValue(undefined) };
  beforeEach(async () => {
    jest.clearAllMocks();
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'zweiblog-comment-quota-'));
    await fs.mkdir(path.join(root, 'img'));
    original = config.staticPath;
    config.staticPath = root;
    uploads.find.mockReturnValue({
      limit: () => ({ toArray: async () => [{ _id: 'a'.repeat(64), name }] }),
    });
    reference.findOne.mockResolvedValue(null);
    statics.updateOne.mockReturnValue({ exec: async () => ({}) });
    statics.deleteOne.mockReturnValue({ exec: async () => ({}) });
    local.saveImg.mockImplementation(async (file: string, bytes: Buffer) => {
      await fs.writeFile(path.join(root, 'img', file), bytes);
      return { realPath: `/static/img/${file}` };
    });
    provider = new CommentImageProvider(
      statics,
      local,
      {
        db: {
          collection: (collection: string) =>
            collection === 'comment_image_uploads' ? uploads : reference,
        },
      } as any,
      { withExclusive: async (_name: string, work: any) => work(lease) } as any,
    );
  });
  afterEach(async () => {
    config.staticPath = original;
    await fs.rm(root, { recursive: true, force: true });
  });
  it('rejects storage growth once anonymous images exhaust the byte quota', async () => {
    const file = await fs.open(path.join(root, 'img', name), 'w');
    await file.truncate(512 * 1024 * 1024);
    await file.close();
    await expect(provider.assertCapacity()).rejects.toThrow('quota');
    expect(local.saveImg).not.toHaveBeenCalled();
  });
  it('records a temporary attachment and links it only after submission', async () => {
    const buffer = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } })
      .webp()
      .toBuffer();
    const result = await provider.saveNormalizedWebp(buffer, {
      path: '/post/7',
      articleId: 7,
      aliases: ['/post/7'],
    });
    expect(result.src).toMatch(/^\/static\/img\/comment-[a-f0-9]{64}\.webp$/);
    expect(uploads.updateOne.mock.calls[0][1].$setOnInsert).toMatchObject({
      path: '/post/7',
      articleId: 7,
      linked: false,
      bytes: buffer.length,
    });
    await provider.linkFromContent(`![image](${result.src})`);
    expect(uploads.updateMany).toHaveBeenCalledWith(
      { name: { $in: [path.basename(result.src)] } },
      { $set: { linked: true } },
    );
  });
  it('removes expired unreferenced attachments and metadata, preserving other files', async () => {
    await fs.writeFile(path.join(root, 'img', name), 'abandoned');
    await fs.writeFile(path.join(root, 'img', 'admin.webp'), 'keep');
    await provider.cleanupExpired();
    await expect(fs.stat(path.join(root, 'img', name))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(path.join(root, 'img', 'admin.webp'), 'utf8')).toBe('keep');
    expect(uploads.deleteOne).toHaveBeenCalledWith({ _id: 'a'.repeat(64), linked: false });
  });
  it('rescues an attachment referenced after an interrupted linking step', async () => {
    await fs.writeFile(path.join(root, 'img', name), 'keep');
    reference.findOne.mockResolvedValueOnce({ _id: 'comment-id' });
    await provider.cleanupExpired();
    expect(await fs.readFile(path.join(root, 'img', name), 'utf8')).toBe('keep');
    expect(uploads.deleteOne).not.toHaveBeenCalled();
    expect(uploads.updateOne).toHaveBeenCalledWith(
      { _id: 'a'.repeat(64) },
      { $set: { linked: true } },
    );
  });
  it('preserves a nested site/about image reference during cleanup', async () => {
    await fs.writeFile(path.join(root, 'img', name), 'keep');
    reference.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ about: { contentEn: `![image](/static/img/${name})` } });
    await provider.cleanupExpired();
    expect(await fs.readFile(path.join(root, 'img', name), 'utf8')).toBe('keep');
    expect(uploads.deleteOne).not.toHaveBeenCalled();
  });
  it('pins administrator references without rejecting external images or filename text', async () => {
    await fs.writeFile(path.join(root, 'img', name), 'keep');
    await provider.retainAdminReferences({ content: `![image](/static/img/${name})` });
    expect(uploads.updateMany).toHaveBeenCalledWith(
      { name: { $in: [name] } },
      { $set: { linked: true } },
    );
    await fs.unlink(path.join(root, 'img', name));
    await expect(
      provider.retainAdminReferences({
        content: `![external](https://example.net/static/img/${name})`,
      }),
    ).resolves.toBeUndefined();
    await expect(
      provider.retainAdminReferences({ content: `Example filename: ${name}` }),
    ).resolves.toBeUndefined();
  });
  it('keeps legacy image files permanent when reuploaded', async () => {
    const buffer = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } })
      .webp()
      .toBuffer();
    const target = { path: '/post/7', articleId: 7, aliases: ['/post/7'] };
    const first = await provider.saveNormalizedWebp(buffer, target);
    uploads.updateOne.mockClear();
    await provider.saveNormalizedWebp(buffer, target);
    expect(uploads.updateOne.mock.calls[0][1].$setOnInsert.linked).toBe(true);
    expect(await fs.stat(path.join(root, 'img', path.basename(first.src)))).toBeTruthy();
  });
  it('retains percent-encoded image references from comments and administrator content', async () => {
    const encoded = name.replace('comment-', '%63omment%2D');
    await provider.linkFromContent(`![image](/static/img/${encoded}) unrelated %ZZ`);
    expect(uploads.updateMany).toHaveBeenLastCalledWith(
      { name: { $in: [name] } },
      { $set: { linked: true } },
    );
    await provider.retainAdminReferences({ content: `![image](/static/img/${encoded})` });
    expect(uploads.updateMany).toHaveBeenLastCalledWith(
      { name: { $in: [name] } },
      { $set: { linked: true } },
    );
    await fs.writeFile(path.join(root, 'img', name), 'keep');
    reference.findOne.mockImplementation(async (query: any) => {
      const rule = query.$or?.[0]?.content;
      return rule && new RegExp(rule.$regex, rule.$options).test(encoded)
        ? { _id: 'referenced' }
        : null;
    });
    await provider.cleanupExpired();
    expect(uploads.deleteOne).not.toHaveBeenCalled();
  });
});
