export type MenuItemKey = string | number;

export type OrderedMenuItem = {
  id: MenuItemKey;
  children?: OrderedMenuItem[];
};

export type MenuMoveDirection = 'up' | 'down';

export type MenuMoveAvailability = {
  canMoveUp: boolean;
  canMoveDown: boolean;
};

export function shouldDisableMenuMove(
  canMove: boolean,
  ordering: boolean,
  editableRowCount: number,
): boolean {
  return !canMove || ordering || editableRowCount > 0;
}

const unavailable: MenuMoveAvailability = {
  canMoveUp: false,
  canMoveDown: false,
};

function findMenuMoveAvailability<T extends OrderedMenuItem>(
  items: T[],
  id: MenuItemKey,
): MenuMoveAvailability | undefined {
  const index = items.findIndex((item) => item.id === id);
  if (index >= 0) {
    return {
      canMoveUp: index > 0,
      canMoveDown: index < items.length - 1,
    };
  }

  for (const item of items) {
    const children = item.children as T[] | undefined;
    if (!children?.length) continue;
    const availability = findMenuMoveAvailability(children, id);
    if (availability) return availability;
  }

  return undefined;
}

export function getMenuMoveAvailability<T extends OrderedMenuItem>(
  items: T[],
  id: MenuItemKey,
): MenuMoveAvailability {
  return findMenuMoveAvailability(items, id) || unavailable;
}

type MoveResult<T> = {
  items: T[];
  found: boolean;
};

function moveWithinTree<T extends OrderedMenuItem>(
  items: T[],
  id: MenuItemKey,
  direction: MenuMoveDirection,
): MoveResult<T> {
  const index = items.findIndex((item) => item.id === id);
  if (index >= 0) {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= items.length) {
      return { items, found: true };
    }

    const nextItems = [...items];
    [nextItems[index], nextItems[targetIndex]] = [nextItems[targetIndex], nextItems[index]];
    return { items: nextItems, found: true };
  }

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const children = item.children as T[] | undefined;
    if (!children?.length) continue;

    const result = moveWithinTree(children, id, direction);
    if (!result.found) continue;
    if (result.items === children) return { items, found: true };

    const nextItems = [...items];
    nextItems[index] = { ...item, children: result.items } as T;
    return { items: nextItems, found: true };
  }

  return { items, found: false };
}

/**
 * Moves an item only inside its current siblings. The complete item subtree is
 * swapped as one value, so nested menu children retain their structure.
 */
export function moveMenuItem<T extends OrderedMenuItem>(
  items: T[],
  id: MenuItemKey,
  direction: MenuMoveDirection,
): T[] {
  return moveWithinTree(items, id, direction).items;
}
