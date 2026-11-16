import {
  buildClubKeysetWhere,
  decodeClubCursor,
  encodeClubCursor,
  type ClubCursorKeySpec,
} from './club-keyset-cursor.util';

/** 单键排序（不可空）：卡包列表 / 护理档案时间线共用形态 */
const SINGLE_KEY: ReadonlyArray<ClubCursorKeySpec> = [
  { field: 'createdAt', nullable: false },
];

/** 双键排序（首键可空）：券订单 refunded / expired Tab */
const NULLABLE_FIRST: ReadonlyArray<ClubCursorKeySpec> = [
  { field: 'refundAt', nullable: true },
  { field: 'createdAt', nullable: false },
];

/** 三键排序（前两键可空）：券订单 used Tab */
const NULLABLE_HEAD: ReadonlyArray<ClubCursorKeySpec> = [
  { field: 'usedAt', nullable: true },
  { field: 'verifyAt', nullable: true },
  { field: 'createdAt', nullable: false },
];

interface SortableRow extends Record<string, number | null> {
  id: number;
}

/** 与数据库 `DESC NULLS LAST` 等价的比较器（末级 id 降序） */
const compareDescNullsLast = (
  left: number | null,
  right: number | null,
): number => {
  if (left === right) {
    return 0;
  }
  // DESC NULLS LAST：NULL 视为最大值，整体排在最后
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  return right - left;
};

/** 按 spec 排序（排序列 + id 降序兜底） */
const sortRows = (
  rows: SortableRow[],
  spec: ReadonlyArray<ClubCursorKeySpec>,
): SortableRow[] =>
  [...rows].sort((left, right) => {
    for (const key of spec) {
      const compared = compareDescNullsLast(
        left[key.field] ?? null,
        right[key.field] ?? null,
      );
      if (compared !== 0) {
        return compared;
      }
    }
    return right.id - left.id;
  });

/** 比较前归一：Date 转毫秒数，其余原样（行数据是毫秒数，游标值是 Date） */
const normalizeKey = (value: unknown): unknown =>
  value instanceof Date ? value.getTime() : value;

/**
 * 测试内的 WHERE 求值器：只支持本工具生成的条件形态
 * （`OR` / 等值 / `IS NULL` / `lt` 比较），用于验证「不漏不重」。
 */
const matchesWhere = (
  row: Record<string, unknown>,
  where: Record<string, unknown>,
): boolean =>
  Object.entries(where).every(([key, value]) => {
    if (key === 'OR') {
      return (value as Array<Record<string, unknown>>).some((branch) =>
        matchesWhere(row, branch),
      );
    }
    if (value === null) {
      return row[key] === null;
    }
    // Date 也是 object：必须先按「时间等值」判掉，否则会被当成没有 lt 的过滤对象
    if (value instanceof Date) {
      return row[key] === value.getTime();
    }
    if (typeof value === 'object') {
      const lt = normalizeKey((value as { lt?: unknown }).lt);
      if (typeof lt !== 'number') {
        return true;
      }
      const actual = row[key];
      return typeof actual === 'number' && actual < lt;
    }
    return normalizeKey(row[key]) === normalizeKey(value);
  });

/** 构造游标位置：排序键值统一还原为 Date（Prisma DateTime 过滤只接受 Date） */
const toPosition = (
  row: SortableRow,
  spec: ReadonlyArray<ClubCursorKeySpec>,
): { values: Array<Date | null>; id: number } => ({
  values: spec.map((key) => {
    const value = row[key.field];
    return typeof value === 'number' ? new Date(value) : null;
  }),
  id: row.id,
});

describe('club-keyset-cursor.util', () => {
  describe('encodeClubCursor / decodeClubCursor', () => {
    it('时间键按毫秒往返，主键保持为数字', () => {
      const created = new Date(1_761_100_000_000);

      const encoded = encodeClubCursor([created], 42);
      const decoded = decodeClubCursor(encoded, SINGLE_KEY);

      expect(decoded).toEqual({ values: [created], id: 42 });
      // 解码结果是 Date：Prisma DateTime 过滤不接受毫秒数字
      expect(decoded?.values[0]).toBeInstanceOf(Date);
    });

    it('可空键用 null 占位符往返，不与数字混淆', () => {
      const createdAt = new Date(1_761_100_000_000);
      const encoded = encodeClubCursor([null, createdAt], 7);

      const decoded = decodeClubCursor(encoded, NULLABLE_FIRST);

      expect(decoded).toEqual({ values: [null, createdAt], id: 7 });
    });

    it('未传游标视为第一页（返回 null，不抛错）', () => {
      expect(decodeClubCursor(undefined, SINGLE_KEY)).toBeNull();
      expect(decodeClubCursor('', SINGLE_KEY)).toBeNull();
    });

    it('游标格式非法 / 键数与 spec 不符 / 不可空键出现 null 时统一 400', () => {
      // 旧版 offset 数字串：offset 分页已下线，不能再被静默当成第一页
      expect(() => decodeClubCursor('20', SINGLE_KEY)).toThrow(
        'cursor 格式不合法',
      );

      const twoKeys = encodeClubCursor([null, new Date(1_761_100_000_000)], 7);
      expect(() => decodeClubCursor(twoKeys, SINGLE_KEY)).toThrow(
        'cursor 格式不合法',
      );

      const withNull = encodeClubCursor([null], 7);
      expect(() => decodeClubCursor(withNull, SINGLE_KEY)).toThrow(
        'cursor 格式不合法',
      );
    });
  });

  describe('buildClubKeysetWhere', () => {
    it('单键不可空：生成「更小值」与「同值靠 id 兜底」两个分支', () => {
      const createdAt = new Date(1_761_100_000_000);
      const where = buildClubKeysetWhere<Record<string, unknown>>(SINGLE_KEY, {
        values: [createdAt],
        id: 42,
      });

      expect(where).toEqual({
        OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: 42 } }],
      });
    });

    it('可空首键：非空游标时把 IS NULL 视为「排在后面」', () => {
      const refundAt = new Date(1_761_100_000_000);
      const createdAt = new Date(1_761_000_000_000);
      const where = buildClubKeysetWhere<Record<string, unknown>>(
        NULLABLE_FIRST,
        { values: [refundAt, createdAt], id: 42 },
      );

      expect(where).toEqual({
        OR: [
          { refundAt: { lt: refundAt } },
          { refundAt: null },
          {
            refundAt,
            OR: [
              { createdAt: { lt: createdAt } },
              { createdAt, id: { lt: 42 } },
            ],
          },
        ],
      });
    });

    it('可空首键为 NULL 的游标：只有同为 NULL 且更深层更靠后的行命中', () => {
      const createdAt = new Date(1_761_000_000_000);
      const where = buildClubKeysetWhere<Record<string, unknown>>(
        NULLABLE_FIRST,
        { values: [null, createdAt], id: 42 },
      );

      expect(where).toEqual({
        OR: [
          {
            refundAt: null,
            OR: [
              { createdAt: { lt: createdAt } },
              { createdAt, id: { lt: 42 } },
            ],
          },
        ],
      });
    });
  });

  describe('全序语义（不漏不重）', () => {
    const ROWS: SortableRow[] = [
      {
        id: 1,
        usedAt: 1_761_100_000_000,
        verifyAt: null,
        refundAt: null,
        createdAt: 100,
      },
      {
        id: 2,
        usedAt: 1_761_100_000_000,
        verifyAt: 50_000,
        refundAt: 90,
        createdAt: 90,
      },
      {
        id: 3,
        usedAt: null,
        verifyAt: 70_000,
        refundAt: null,
        createdAt: 80,
      },
      {
        id: 4,
        usedAt: null,
        verifyAt: null,
        refundAt: 70,
        createdAt: 70,
      },
      {
        id: 5,
        usedAt: null,
        verifyAt: null,
        refundAt: null,
        createdAt: 70,
      },
      {
        id: 6,
        usedAt: 1_761_000_000_000,
        verifyAt: null,
        refundAt: 60,
        createdAt: 60,
      },
    ];

    const SPECS: Array<[string, ReadonlyArray<ClubCursorKeySpec>]> = [
      ['单键', SINGLE_KEY],
      ['可空首键', NULLABLE_FIRST],
      ['双可空键', NULLABLE_HEAD],
    ];

    it.each(SPECS)(
      '%s：任意游标位置之后的行，恰好等于全序列表中被游标跳过的那一段',
      (_label, spec) => {
        const sorted = sortRows(ROWS, spec);

        for (let index = 0; index < sorted.length - 1; index += 1) {
          const cursorRow = sorted[index];
          const where = buildClubKeysetWhere<Record<string, unknown>>(
            spec,
            toPosition(cursorRow, spec),
          );

          const rest = sorted.filter((row) => matchesWhere(row, where));

          // 不漏：游标之后的每一行都在结果里；不重：游标及之前的行都不在
          expect(rest.map((row) => row.id)).toEqual(
            sorted.slice(index + 1).map((row) => row.id),
          );
        }
      },
    );

    it('并列排序值（同 usedAt/verifyAt/createdAt）不会因分页边界丢行或重复', () => {
      const sorted = sortRows(ROWS, NULLABLE_HEAD);
      const cursorRow = sorted[3];
      const where = buildClubKeysetWhere<Record<string, unknown>>(
        NULLABLE_HEAD,
        toPosition(cursorRow, NULLABLE_HEAD),
      );

      const rest = sorted.filter((row) => matchesWhere(row, where));

      expect(rest).toHaveLength(sorted.length - 4);
      expect(new Set(rest.map((row) => row.id)).size).toBe(rest.length);
    });
  });
});
