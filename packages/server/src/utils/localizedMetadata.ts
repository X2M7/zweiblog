import { BadRequestException } from '@nestjs/common';
import { MenuItem } from 'src/types/menu.dto';

export const LOCALIZED_NAME_MAX_LENGTH = 200;
export const LOCALIZED_DESCRIPTION_MAX_LENGTH = 2_000;
export const LOCALIZED_CONTENT_MAX_LENGTH = 4_000_000;
export const MENU_VALUE_MAX_LENGTH = 2_048;
export const MENU_MAX_ITEMS = 200;
export const MENU_MAX_DEPTH = 2;

export interface TextFieldRule {
  field: string;
  maxLength: number;
  required?: boolean;
}

export function assertTextFields(
  data: Record<string, unknown>,
  rules: readonly TextFieldRule[],
  resource: string,
): void {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new BadRequestException(`${resource} must be an object`);
  }

  for (const { field, maxLength, required } of rules) {
    const supplied = Object.prototype.hasOwnProperty.call(data, field);
    if (!supplied) {
      if (required) throw new BadRequestException(`${resource} ${field} is required`);
      continue;
    }
    const value = data[field];
    if (typeof value !== 'string') {
      throw new BadRequestException(`${resource} ${field} must be a string`);
    }
    if (required && !value.trim()) {
      throw new BadRequestException(`${resource} ${field} is required`);
    }
    if (value.length > maxLength) {
      throw new BadRequestException(
        `${resource} ${field} must contain at most ${maxLength} characters`,
      );
    }
  }
}

export function assertMenuItems(data: unknown): asserts data is MenuItem[] {
  if (!Array.isArray(data)) {
    throw new BadRequestException('Menu data must be an array');
  }

  let itemCount = 0;
  const visit = (items: unknown[], depth: number) => {
    if (depth > MENU_MAX_DEPTH) {
      throw new BadRequestException(`Menu supports at most ${MENU_MAX_DEPTH} levels`);
    }
    for (const raw of items) {
      itemCount += 1;
      if (itemCount > MENU_MAX_ITEMS) {
        throw new BadRequestException(`Menu supports at most ${MENU_MAX_ITEMS} items`);
      }
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new BadRequestException('Menu item must be an object');
      }
      const item = raw as Record<string, unknown>;
      assertTextFields(
        item,
        [
          { field: 'name', maxLength: LOCALIZED_NAME_MAX_LENGTH, required: true },
          { field: 'nameEn', maxLength: LOCALIZED_NAME_MAX_LENGTH },
          { field: 'value', maxLength: MENU_VALUE_MAX_LENGTH, required: true },
        ],
        'Menu item',
      );
      if (!Number.isSafeInteger(item.level) || Number(item.level) < 0) {
        throw new BadRequestException('Menu item level must be a non-negative integer');
      }
      if (typeof item.id !== 'number' && typeof item.id !== 'string') {
        throw new BadRequestException('Menu item id must be a number or string');
      }
      if (item.children !== undefined) {
        if (!Array.isArray(item.children)) {
          throw new BadRequestException('Menu item children must be an array');
        }
        visit(item.children, depth + 1);
      }
    }
  };

  visit(data, 1);
}

export function mergeMenuLocalizedFields(
  incoming: MenuItem[],
  existing: MenuItem[] = [],
): MenuItem[] {
  return incoming.map((item) => {
    const oldItem = existing.find(
      (candidate) =>
        candidate.id === item.id ||
        (candidate.name === item.name &&
          candidate.value === item.value &&
          candidate.level === item.level),
    );
    const merged: MenuItem = { ...item };
    if (!Object.prototype.hasOwnProperty.call(item, 'nameEn')) {
      merged.nameEn = typeof oldItem?.nameEn === 'string' ? oldItem.nameEn : '';
    }
    if (Array.isArray(item.children)) {
      merged.children = mergeMenuLocalizedFields(
        item.children,
        Array.isArray(oldItem?.children) ? oldItem.children : [],
      );
    }
    return merged;
  });
}
