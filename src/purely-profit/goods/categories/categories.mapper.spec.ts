import { buildCategoryResponse } from './categories.mapper';
import type { CategoryRecord } from './categories.types';

describe('categories.mapper', () => {
  function createCategoryRecordFixture(
    overrides?: Partial<CategoryRecord>,
  ): CategoryRecord {
    return {
      id: 11,
      storeId: 18,
      name: '饮品',
      icon: '🥤',
      createdAt: new Date('2026-05-23T10:00:00.000Z'),
      updatedAt: new Date('2026-05-23T10:05:00.000Z'),
      ...overrides,
    };
  }

  it('buildCategoryResponse 会映射基础字段和时间戳', () => {
    const record = createCategoryRecordFixture();

    expect(buildCategoryResponse(record)).toEqual({
      id: '11',
      name: '饮品',
      icon: '🥤',
      createdAt: record.createdAt.getTime(),
      updatedAt: record.updatedAt.getTime(),
    });
  });

  it('buildCategoryResponse 会省略空 icon 字段', () => {
    const record = createCategoryRecordFixture({ icon: null });

    expect(buildCategoryResponse(record)).toEqual({
      id: '11',
      name: '饮品',
      createdAt: record.createdAt.getTime(),
      updatedAt: record.updatedAt.getTime(),
    });
  });
});
