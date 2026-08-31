import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canMoveLinkName, isLinkOrderingLocked, moveLinkName } from './linkOrder';

const { requestMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
}));

vi.mock('umi', () => ({ request: requestMock }));

import { updateLinkOrder } from '../../../services/zwei-blog/api';

describe('friend-link ordering', () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockResolvedValue({ data: {} });
  });

  it('moves only the selected name by one position without mutating input', () => {
    const names = ['Alpha', 'Beta', 'Gamma'];

    expect(moveLinkName(names, 'Beta', 'up')).toEqual(['Beta', 'Alpha', 'Gamma']);
    expect(moveLinkName(names, 'Beta', 'down')).toEqual(['Alpha', 'Gamma', 'Beta']);
    expect(names).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('disables boundaries and leaves invalid moves unchanged', () => {
    const names = ['Alpha', 'Beta', 'Gamma'];

    expect(canMoveLinkName(names, 'Alpha', 'up')).toBe(false);
    expect(canMoveLinkName(names, 'Alpha', 'down')).toBe(true);
    expect(canMoveLinkName(names, 'Gamma', 'down')).toBe(false);
    expect(canMoveLinkName(names, 'Missing', 'up')).toBe(false);
    expect(moveLinkName(names, 'Alpha', 'up')).toEqual(names);
    expect(moveLinkName(names, 'Gamma', 'down')).toEqual(names);
    expect(moveLinkName(names, 'Missing', 'up')).toEqual(names);
  });

  it('locks every sorting control while any row is editable or a request is active', () => {
    expect(isLinkOrderingLocked([], false)).toBe(false);
    expect(isLinkOrderingLocked(['Alpha'], false)).toBe(true);
    expect(isLinkOrderingLocked([], true)).toBe(true);
    expect(isLinkOrderingLocked(['Alpha'], true)).toBe(true);
  });

  it('sends the complete ordered name list to the unified API', async () => {
    const names = ['Beta', 'Alpha', 'Gamma'];

    await updateLinkOrder(names);

    expect(requestMock).toHaveBeenCalledWith('/api/admin/meta/link/order', {
      method: 'PUT',
      data: { names },
    });
  });
});
