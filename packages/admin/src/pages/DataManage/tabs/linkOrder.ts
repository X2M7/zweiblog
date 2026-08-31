export type LinkMoveDirection = 'up' | 'down';

export function isLinkOrderingLocked(editableKeys: readonly unknown[], ordering: boolean): boolean {
  return ordering || editableKeys.length > 0;
}

export function canMoveLinkName(
  names: string[],
  name: string,
  direction: LinkMoveDirection,
): boolean {
  const index = names.indexOf(name);
  if (index < 0) return false;
  return direction === 'up' ? index > 0 : index < names.length - 1;
}

export function moveLinkName(
  names: string[],
  name: string,
  direction: LinkMoveDirection,
): string[] {
  const nextNames = [...names];
  if (!canMoveLinkName(nextNames, name, direction)) return nextNames;

  const currentIndex = nextNames.indexOf(name);
  const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
  [nextNames[currentIndex], nextNames[nextIndex]] = [nextNames[nextIndex], nextNames[currentIndex]];
  return nextNames;
}
