// 营销流水列表游标分页单测夹具：把 `$queryRaw` 的模板参数展平后按 SQL 文本识别
// 「列表 / count 查询」，再用内存数据模拟 where 与 ORDER BY，供 spec 复用。
//
// 单测里只能看到「模板字符串 + 参数」，看不到 Postgres 的执行结果；这里刻意按 SQL
// 文本判断走了哪条路径（游标条件 / OFFSET / COUNT），避免测试自己臆造语义。
import {
  isRowAfterMarketingFlowCursor,
  type MarketingFlowCursor,
} from './marketing-flow.cursor';
import type { MarketingServiceTestingContext } from './marketing.service.test-setup';

export interface FlatRawQuery {
  text: string;
  params: unknown[];
}

const PLACEHOLDER = '?';

/** 游标条件片段（行值比较）：`(别名.created_at, 别名.id) < (?, ?)` */
export const CURSOR_CONDITION = /\(\s*\w+\.created_at\s*,\s*\w+\.id\s*\)\s*</;

export interface FakeFlowRow {
  id: number;
  storeId: number;
  customerId: number;
  createdAt: Date;
  [key: string]: unknown;
}

const isSqlFragment = (
  value: unknown,
): value is { strings: readonly string[]; values: unknown[] } => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { strings?: unknown; values?: unknown };
  return Array.isArray(candidate.strings) && Array.isArray(candidate.values);
};

export const flattenRawQuery = (
  strings: readonly string[],
  values: unknown[],
): FlatRawQuery => {
  const chunks: string[] = [];
  const params: unknown[] = [];

  const emit = (value: unknown): void => {
    if (isSqlFragment(value)) {
      const inner = flattenRawQuery(value.strings, value.values);
      chunks.push(inner.text);
      params.push(...inner.params);
      return;
    }
    chunks.push(PLACEHOLDER);
    params.push(value);
  };

  strings.forEach((chunk, index) => {
    chunks.push(chunk);
    if (index < values.length) {
      emit(values[index]);
    }
  });

  return { text: chunks.join(''), params };
};

const isCountOnlyQuery = (flat: FlatRawQuery): boolean =>
  flat.text.includes('COUNT(*)') && !flat.text.includes('OVER()');

/** 游标参数紧跟条件片段，按「条件前的占位符个数」定位，不依赖筛选条件数量 */
const readCursorFromQuery = (
  flat: FlatRawQuery,
): MarketingFlowCursor | null => {
  const match = CURSOR_CONDITION.exec(flat.text);
  if (!match || match.index === undefined) {
    return null;
  }
  const firstParamIndex =
    flat.text.slice(0, match.index).split(PLACEHOLDER).length - 1;
  const createdAt = flat.params[firstParamIndex];
  const id = flat.params[firstParamIndex + 1];
  if (!(createdAt instanceof Date) || typeof id !== 'number') {
    return null;
  }
  return { createdAt, id };
};

const sortByFlowOrder = <TRow extends { createdAt: Date; id: number }>(
  rows: TRow[],
): TRow[] =>
  [...rows].sort(
    (left, right) =>
      right.createdAt.getTime() - left.createdAt.getTime() ||
      right.id - left.id,
  );

/** 用内存数据模拟两张流水表的列表/count 查询，返回本次产生的 SQL 展平结果 */
export const installFlowTableMock = <TRow extends FakeFlowRow>(
  context: MarketingServiceTestingContext,
  dataset: TRow[],
): FlatRawQuery[] => {
  const flats: FlatRawQuery[] = [];
  context.prismaService.$queryRaw.mockImplementation(
    (strings: readonly string[], ...values: unknown[]) => {
      const flat = flattenRawQuery(strings, values);
      flats.push(flat);

      if (isCountOnlyQuery(flat)) {
        return Promise.resolve([{ total: dataset.length }]);
      }

      const cursor = readCursorFromQuery(flat);
      const ordered = sortByFlowOrder(
        cursor
          ? dataset.filter((row) => isRowAfterMarketingFlowCursor(row, cursor))
          : dataset,
      );

      if (cursor) {
        // 游标路径：LIMIT take
        const take = Number(flat.params.at(-1));
        return Promise.resolve(ordered.slice(0, take));
      }

      // offset 路径：LIMIT take OFFSET skip，总数由 COUNT(*) OVER() 随行带回
      const take = Number(flat.params.at(-2));
      const skip = Number(flat.params.at(-1));
      return Promise.resolve(
        ordered
          .slice(skip, skip + take)
          .map((row) => ({ ...row, _total: dataset.length })),
      );
    },
  );
  return flats;
};

export const at = (iso: string): Date => new Date(iso);

export const rechargeRow = (id: number, createdAt: Date): FakeFlowRow => ({
  id,
  storeId: 18,
  customerId: 7,
  amount: 100,
  giftAmount: 0,
  totalAmount: 100,
  type: 'recharge',
  promotionId: null,
  promotionName: null,
  note: null,
  customerName: `顾客${id}`,
  createdAt,
});

export const pointsRow = (id: number, createdAt: Date): FakeFlowRow => ({
  id,
  storeId: 18,
  customerId: 7,
  amount: 10,
  type: 'earn',
  description: '充值赠送',
  createdAt,
});

/** id 3/4/5/6 共用同一个 created_at：覆盖「同排序值多条」的 id 兜底场景 */
export const rechargeDataset = [
  rechargeRow(1, at('2026-05-14T08:00:00.000Z')),
  rechargeRow(2, at('2026-05-15T08:00:00.000Z')),
  rechargeRow(3, at('2026-05-15T09:00:00.000Z')),
  rechargeRow(4, at('2026-05-15T09:00:00.000Z')),
  rechargeRow(5, at('2026-05-15T09:00:00.000Z')),
  rechargeRow(6, at('2026-05-15T09:00:00.000Z')),
];

export const pointsDataset = [
  pointsRow(1, at('2026-05-14T08:00:00.000Z')),
  pointsRow(2, at('2026-05-15T09:00:00.000Z')),
  pointsRow(3, at('2026-05-15T09:00:00.000Z')),
  pointsRow(4, at('2026-05-15T09:00:00.000Z')),
];
