import { describe, expect, it } from 'vitest';
import {
  getMenuMoveAvailability,
  moveMenuItem,
  shouldDisableMenuMove,
} from './menuOrder';

const makeMenu = () => [
  {
    id: 1,
    name: '首页',
    children: [
      { id: 11, name: '首页甲' },
      { id: 12, name: '首页乙', children: [{ id: 121, name: '孙级数据' }] },
      { id: 13, name: '首页丙' },
    ],
  },
  { id: 2, name: '归档', children: [{ id: 21, name: '归档子项' }] },
  { id: 3, name: '友链' },
];

describe('navigation menu ordering', () => {
  it('moves a complete top-level subtree without mutating the source', () => {
    const menu = makeMenu();
    const moved = moveMenuItem(menu, 2, 'up');

    expect(moved.map((item) => item.id)).toEqual([2, 1, 3]);
    expect(moved[0].children).toBe(menu[1].children);
    expect(menu.map((item) => item.id)).toEqual([1, 2, 3]);
  });

  it('reorders a child only within its own siblings and preserves descendants', () => {
    const menu = makeMenu();
    const moved = moveMenuItem(menu, 12, 'down');

    expect(moved.map((item) => item.id)).toEqual([1, 2, 3]);
    expect(moved[0].children?.map((item) => item.id)).toEqual([11, 13, 12]);
    expect(moved[0].children?.[2].children).toEqual([{ id: 121, name: '孙级数据' }]);
    expect(moved[1]).toBe(menu[1]);
  });

  it('disables sibling boundaries and treats impossible moves as no-ops', () => {
    const menu = makeMenu();

    expect(getMenuMoveAvailability(menu, 1)).toEqual({
      canMoveUp: false,
      canMoveDown: true,
    });
    expect(getMenuMoveAvailability(menu, 11)).toEqual({
      canMoveUp: false,
      canMoveDown: true,
    });
    expect(getMenuMoveAvailability(menu, 13)).toEqual({
      canMoveUp: true,
      canMoveDown: false,
    });
    expect(moveMenuItem(menu, 11, 'up')).toBe(menu);
    expect(moveMenuItem(menu, 999, 'down')).toBe(menu);
  });

  it('blocks ordering while a save is running or any row is being edited', () => {
    expect(shouldDisableMenuMove(true, false, 0)).toBe(false);
    expect(shouldDisableMenuMove(false, false, 0)).toBe(true);
    expect(shouldDisableMenuMove(true, true, 0)).toBe(true);
    expect(shouldDisableMenuMove(true, false, 1)).toBe(true);
  });
});
