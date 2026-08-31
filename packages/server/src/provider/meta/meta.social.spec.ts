import { BadRequestException } from '@nestjs/common';
import { MetaProvider } from './meta.provider';
import { SOCIAL_TYPE_OPTIONS } from 'src/types/social.dto';

const queryResult = (value: any) => ({ exec: jest.fn().mockResolvedValue(value) });

const makeProvider = (meta: any) => {
  const metaModel: any = {
    findOne: jest.fn().mockReturnValue(queryResult(meta)),
    updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
  };
  return {
    provider: new MetaProvider(metaModel, {} as any, {} as any, {} as any, {} as any),
    metaModel,
  };
};

describe('MetaProvider social compatibility', () => {
  it('serves the single categorized option catalog to the admin client', async () => {
    const { provider } = makeProvider({});

    await expect(provider.getSocialTypes()).resolves.toBe(SOCIAL_TYPE_OPTIONS);
  });

  it.each([undefined, null, {}])(
    'returns an empty array for missing legacy socials',
    async (meta) => {
      const { provider } = makeProvider(meta);
      await expect(provider.getSocials()).resolves.toEqual([]);
    },
  );

  it('returns legacy unknown and unsafe records without breaking old metadata reads', async () => {
    const socials = [
      { type: 'legacy-network', value: 'javascript:legacy()', updatedAt: new Date(0) },
    ];
    const { provider } = makeProvider({ socials });

    await expect(provider.getSocials()).resolves.toBe(socials);
  });

  it('upserts by type, trims the value, removes duplicate matches, and preserves other records', async () => {
    const untouched = { type: 'legacy-network', value: 'legacy:value', extra: true };
    const { provider, metaModel } = makeProvider({
      socials: [
        untouched,
        { type: 'github', value: 'https://github.com/old' },
        { type: 'github', value: 'https://github.com/duplicate' },
      ],
    });

    await provider.addOrUpdateSocial({
      type: 'github',
      value: ' https://github.com/new ',
    });

    const saved = metaModel.updateOne.mock.calls[0][1].socials;
    expect(saved).toHaveLength(2);
    expect(saved[0]).toBe(untouched);
    expect(saved[1]).toMatchObject({ type: 'github', value: 'https://github.com/new' });
    expect(saved[1].updatedAt).toBeInstanceOf(Date);
  });

  it('creates the socials array when it is absent', async () => {
    const { provider, metaModel } = makeProvider({});

    await provider.addOrUpdateSocial({ type: 'email', value: 'mailto:user@example.com' });

    expect(metaModel.updateOne.mock.calls[0][1].socials).toEqual([
      expect.objectContaining({ type: 'email', value: 'mailto:user@example.com' }),
    ]);
  });

  it('rejects invalid new data without writing', async () => {
    const { provider, metaModel } = makeProvider({ socials: [] });

    await expect(
      provider.addOrUpdateSocial({ type: 'github', value: 'javascript:alert(1)' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(metaModel.updateOne).not.toHaveBeenCalled();
  });

  it('deletes safely when a legacy document has no socials array', async () => {
    const { provider, metaModel } = makeProvider({});

    await provider.deleteSocial('github');

    expect(metaModel.updateOne).toHaveBeenCalledWith({}, { socials: [] });
  });

  it('allows an unknown but safe legacy type to be deleted', async () => {
    const legacy = { type: 'old-network', value: 'legacy:value' };
    const github = { type: 'github', value: 'https://github.com/example' };
    const { provider, metaModel } = makeProvider({ socials: [legacy, github] });

    await provider.deleteSocial(' old-network ');

    expect(metaModel.updateOne).toHaveBeenCalledWith({}, { socials: [github] });
  });

  it.each(['../github', 'GitHub', 'github?all=true', ''])(
    'rejects an unsafe delete key: %s',
    async (type) => {
      const { provider, metaModel } = makeProvider({ socials: [] });

      await expect(provider.deleteSocial(type as any)).rejects.toBeInstanceOf(BadRequestException);
      expect(metaModel.updateOne).not.toHaveBeenCalled();
    },
  );
});
