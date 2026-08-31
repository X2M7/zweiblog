import { BadRequestException } from '@nestjs/common';
import {
  assertMenuItems,
  assertTextFields,
  LOCALIZED_NAME_MAX_LENGTH,
  mergeMenuLocalizedFields,
} from './localizedMetadata';

describe('localized metadata validation', () => {
  it('accepts optional localized strings and rejects unsafe values', () => {
    expect(() =>
      assertTextFields(
        { nameEn: '' },
        [{ field: 'nameEn', maxLength: LOCALIZED_NAME_MAX_LENGTH }],
        'Item',
      ),
    ).not.toThrow();
    expect(() =>
      assertTextFields(
        { nameEn: { text: 'English' } },
        [{ field: 'nameEn', maxLength: LOCALIZED_NAME_MAX_LENGTH }],
        'Item',
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      assertTextFields(
        { nameEn: 'x'.repeat(LOCALIZED_NAME_MAX_LENGTH + 1) },
        [{ field: 'nameEn', maxLength: LOCALIZED_NAME_MAX_LENGTH }],
        'Item',
      ),
    ).toThrow(BadRequestException);
  });

  it('validates bilingual menu trees and requires children to be arrays', () => {
    expect(() =>
      assertMenuItems([
        {
          id: 1,
          name: '关于',
          nameEn: 'About',
          value: '/about',
          level: 0,
          children: [{ id: 2, name: '团队', nameEn: 'Team', value: '/team', level: 1 }],
        },
      ]),
    ).not.toThrow();
    expect(() =>
      assertMenuItems([{ id: 1, name: '关于', value: '/about', level: 0, children: { id: 2 } }]),
    ).toThrow(BadRequestException);
  });

  it('preserves nested English menu names for legacy clients while allowing explicit clears', () => {
    const existing: any = [
      {
        id: 1,
        name: '关于',
        nameEn: 'About',
        value: '/about',
        level: 0,
        children: [{ id: 2, name: '团队', nameEn: 'Team', value: '/team', level: 1 }],
      },
    ];

    expect(
      mergeMenuLocalizedFields(
        [
          {
            id: 1,
            name: '关于我们',
            value: '/about',
            level: 0,
            children: [{ id: 2, name: '团队介绍', value: '/team', level: 1 }],
          },
        ],
        existing,
      ),
    ).toMatchObject([{ nameEn: 'About', children: [{ nameEn: 'Team' }] }]);
    expect(
      mergeMenuLocalizedFields(
        [{ id: 1, name: '关于', nameEn: '', value: '/about', level: 0 }],
        existing,
      )[0].nameEn,
    ).toBe('');
  });
});
