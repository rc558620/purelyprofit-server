import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  buildMarketingFlowCursorSql,
  buildMarketingFlowPage,
  decodeMarketingFlowCursor,
  encodeMarketingFlowCursor,
  isRowAfterMarketingFlowCursor,
  resolveMarketingFlowPaging,
  type MarketingFlowPaging,
} from './marketing-flow.cursor';

/** 构造分页归一结果，避免每个用例重复拼同一份对象 */
const pagingOf = (
  overrides: Partial<MarketingFlowPaging>,
): MarketingFlowPaging => ({
  page: 1,
  limit: 2,
  offset: 0,
  cursor: null,
  ...overrides,
});

const rowOf = (id: number, iso: string) => ({ id, createdAt: new Date(iso) });

describe('marketing-flow.cursor', () => {
  describe('encodeMarketingFlowCursor / decodeMarketingFlowCursor', () => {
    it('编解码往返保留排序键与主键（created_at 为毫秒精度，无精度损失）', () => {
      const cursor = decodeMarketingFlowCursor(
        encodeMarketingFlowCursor(rowOf(42, '2026-05-15T09:00:00.123Z')),
      );

      expect(cursor).toEqual({
        createdAt: new Date('2026-05-15T09:00:00.123Z'),
        id: 42,
      });
    });

    it('空值视为第一页', () => {
      expect(decodeMarketingFlowCursor(undefined)).toBeNull();
      expect(decodeMarketingFlowCursor(null)).toBeNull();
      expect(decodeMarketingFlowCursor('   ')).toBeNull();
    });

    it.each([
      ['缺失版本前缀', 'eyJrZXlzIjpbMV0sImlkIjoyfQ'],
      ['base64 内容非 JSON', 'v1:bm90LWpzb24'],
      [
        '排序键不是数字',
        `v1:${Buffer.from('{"keys":["x"],"id":2}').toString('base64url')}`,
      ],
      [
        'id 非正整数',
        `v1:${Buffer.from('{"keys":[1],"id":0}').toString('base64url')}`,
      ],
    ])('非法游标（%s）抛 400', (_label, raw) => {
      expect(() => decodeMarketingFlowCursor(raw)).toThrow(BadRequestException);
    });
  });

  describe('resolveMarketingFlowPaging', () => {
    it('cursor 优先：同时传 page 时 offset 不生效', () => {
      const paging = resolveMarketingFlowPaging({
        page: 5,
        pageSize: 10,
        cursor: encodeMarketingFlowCursor(rowOf(7, '2026-05-15T09:00:00.000Z')),
      });

      expect(paging.limit).toBe(10);
      expect(paging.cursor).toEqual({
        createdAt: new Date('2026-05-15T09:00:00.000Z'),
        id: 7,
      });
    });

    it('未传 cursor 时保持迁移前的 skip/take 口径', () => {
      const paging = resolveMarketingFlowPaging({ page: 3, pageSize: 20 });

      expect(paging).toEqual({
        page: 3,
        limit: 20,
        offset: 40,
        cursor: null,
      });
    });
  });

  describe('buildMarketingFlowCursorSql', () => {
    it('生成行值比较条件，并把游标值作为参数绑定（不拼字面量）', () => {
      const cursor = {
        createdAt: new Date('2026-05-15T09:00:00.000Z'),
        id: 42,
      };
      const fragment = buildMarketingFlowCursorSql(cursor, {
        createdAt: Prisma.sql`r.created_at`,
        id: Prisma.sql`r.id`,
      });

      expect(fragment.text).toContain('AND (r.created_at, r.id) < (');
      expect(fragment.text).not.toContain('2026-05-15');
      expect(fragment.values).toEqual([cursor.createdAt, 42]);
    });
  });

  describe('isRowAfterMarketingFlowCursor', () => {
    it('created_at 更早即在游标之后；相同时用 id 兜底', () => {
      const cursor = {
        createdAt: new Date('2026-05-15T09:00:00.000Z'),
        id: 10,
      };

      expect(
        isRowAfterMarketingFlowCursor(
          rowOf(99, '2026-05-15T08:59:59.999Z'),
          cursor,
        ),
      ).toBe(true);
      expect(
        isRowAfterMarketingFlowCursor(
          rowOf(9, '2026-05-15T09:00:00.000Z'),
          cursor,
        ),
      ).toBe(true);
      expect(
        isRowAfterMarketingFlowCursor(
          rowOf(10, '2026-05-15T09:00:00.000Z'),
          cursor,
        ),
      ).toBe(false);
      expect(
        isRowAfterMarketingFlowCursor(
          rowOf(11, '2026-05-15T09:00:00.000Z'),
          cursor,
        ),
      ).toBe(false);
      expect(
        isRowAfterMarketingFlowCursor(
          rowOf(1, '2026-05-15T09:00:00.001Z'),
          cursor,
        ),
      ).toBe(false);
    });
  });

  describe('buildMarketingFlowPage', () => {
    it('游标路径：limit+1 探测行说明还有下一页，nextCursor 取本页最后一行', () => {
      const rows = [
        rowOf(9, '2026-05-15T09:00:00.000Z'),
        rowOf(8, '2026-05-15T09:00:00.000Z'),
        rowOf(7, '2026-05-15T08:00:00.000Z'),
      ];
      const page = buildMarketingFlowPage(
        rows,
        30,
        pagingOf({
          limit: 2,
          offset: 4,
          cursor: { createdAt: new Date('2026-05-15T10:00:00.000Z'), id: 10 },
        }),
      );

      expect(page.rows.map((row) => row.id)).toEqual([9, 8]);
      expect(page.hasMore).toBe(true);
      // 探测行不能泄漏进 nextCursor：游标必须指向本页最后一条
      expect(decodeMarketingFlowCursor(page.nextCursor)).toEqual({
        createdAt: new Date('2026-05-15T09:00:00.000Z'),
        id: 8,
      });
      // 游标路径下 meta 仍按全量 total 口径回填
      expect(page.meta).toEqual({
        page: 1,
        pageSize: 2,
        total: 30,
        totalPages: 15,
      });
    });

    it('游标路径末页：探测行不足即到底，nextCursor 为 null', () => {
      const page = buildMarketingFlowPage(
        [rowOf(3, '2026-05-15T08:00:00.000Z')],
        30,
        pagingOf({
          limit: 2,
          cursor: { createdAt: new Date('2026-05-15T09:00:00.000Z'), id: 4 },
        }),
      );

      expect(page.rows.map((row) => row.id)).toEqual([3]);
      expect(page.hasMore).toBe(false);
      expect(page.nextCursor).toBeNull();
    });

    it('offset 路径：offset + 已取条数 < total 才认为还有下一页', () => {
      const rows = [
        rowOf(9, '2026-05-15T09:00:00.000Z'),
        rowOf(8, '2026-05-15T08:00:00.000Z'),
      ];

      const notLast = buildMarketingFlowPage(
        rows,
        30,
        pagingOf({ limit: 2, offset: 2 }),
      );
      expect(notLast.hasMore).toBe(true);
      expect(decodeMarketingFlowCursor(notLast.nextCursor)?.id).toBe(8);

      const last = buildMarketingFlowPage(
        rows,
        4,
        pagingOf({ limit: 2, offset: 2 }),
      );
      expect(last.hasMore).toBe(false);
      expect(last.nextCursor).toBeNull();
    });

    it('恒等式 hasMore === (nextCursor !== null) 在两条路径下都成立', () => {
      const cases = [
        pagingOf({ limit: 2, offset: 0 }),
        pagingOf({ limit: 2, offset: 4 }),
        pagingOf({
          limit: 2,
          cursor: { createdAt: new Date('2026-05-15T09:00:00.000Z'), id: 4 },
        }),
      ];
      const rows = [
        rowOf(3, '2026-05-15T08:00:00.000Z'),
        rowOf(2, '2026-05-15T07:00:00.000Z'),
        rowOf(1, '2026-05-15T06:00:00.000Z'),
      ];

      for (const paging of cases) {
        const page = buildMarketingFlowPage(rows, 5, paging);
        expect(page.hasMore).toBe(page.nextCursor !== null);
      }
    });

    it('空结果不回填游标', () => {
      const page = buildMarketingFlowPage([], 0, pagingOf({ limit: 2 }));

      expect(page.rows).toEqual([]);
      expect(page.hasMore).toBe(false);
      expect(page.nextCursor).toBeNull();
    });
  });
});
