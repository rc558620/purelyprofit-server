import type { MemberRechargeChannelValue } from './members.utils';
import { replaceMemberRechargeHistory } from './members-write.query';

type RechargeItem = {
  id?: string;
  planName: string;
  amount: number;
  pointsAwarded: number;
  channel: MemberRechargeChannelValue;
  createdAt: number;
};

type SqlLike = { strings: readonly string[]; values: readonly unknown[] };

const isSqlLike = (value: unknown): value is SqlLike =>
  typeof value === 'object' &&
  value !== null &&
  'strings' in value &&
  'values' in value;

/**
 * $executeRaw 以 tagged template 调用，mock 收到的是 (strings, ...values)，
 * 不是 Prisma.Sql 实例；静态文本在第一个参数里，足以断言语句类型。
 */
const sqlTextOf = (args: unknown[]): string => {
  const head = args[0];
  if (Array.isArray(head)) {
    return (head as string[]).join('?');
  }
  return isSqlLike(head) ? String((head as { text?: string }).text ?? '') : '';
};

/** 递归展开嵌套 Sql，收集所有插值（用于断言金额换算结果） */
const collectValues = (args: unknown[]): unknown[] => {
  const result: unknown[] = [];
  const walk = (value: unknown): void => {
    if (isSqlLike(value)) {
      value.values.forEach(walk);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    result.push(value);
  };
  args.forEach(walk);
  return result;
};

const createClient = (
  existing: Array<{ id: number; operatorStaffId: number | null }>,
) => ({
  $queryRaw: jest.fn().mockResolvedValue(existing),
  $executeRaw: jest.fn().mockResolvedValue(1),
});

const sqlTextsOf = (client: ReturnType<typeof createClient>): string[] =>
  client.$executeRaw.mock.calls.map((args) => sqlTextOf(args as unknown[]));

const countBy = (texts: string[], keyword: string): number =>
  texts.filter((text) => text.includes(keyword)).length;

const item = (overrides: Partial<RechargeItem> & { planName: string }) => ({
  amount: 99,
  pointsAwarded: 0,
  channel: 'wechat' as MemberRechargeChannelValue,
  createdAt: 1747123200000,
  ...overrides,
});

const baseParams = { memberId: 7, storeId: 18, operatorStaffId: 55 };

describe('replaceMemberRechargeHistory', () => {
  it('混合场景：命中的更新、缺失的删除、其余批量插入', async () => {
    const client = createClient([
      { id: 11, operatorStaffId: 3 },
      { id: 12, operatorStaffId: 4 },
    ]);

    await replaceMemberRechargeHistory(client as never, {
      ...baseParams,
      rechargeHistory: [
        item({ id: 'rc-11', planName: '季度会员' }),
        item({ planName: '年度会员' }),
      ],
    });

    const texts = sqlTextsOf(client);
    expect(countBy(texts, 'DELETE FROM member_recharge_logs')).toBe(1);
    expect(countBy(texts, 'UPDATE member_recharge_logs')).toBe(1);
    expect(countBy(texts, 'INSERT INTO member_recharge_logs')).toBe(1);
  });

  it('更新时不得改写 operator_staff_id（审计归属不被后续编辑篡改）', async () => {
    const client = createClient([{ id: 11, operatorStaffId: 3 }]);

    await replaceMemberRechargeHistory(client as never, {
      ...baseParams,
      rechargeHistory: [item({ id: 'rc-11', planName: '季度会员' })],
    });

    const updateSql = sqlTextsOf(client).find((text) =>
      text.includes('UPDATE member_recharge_logs'),
    );
    expect(updateSql).not.toContain('operator_staff_id');
  });

  it('无存量记录时不产生 DELETE，只做一次批量插入', async () => {
    const client = createClient([]);

    await replaceMemberRechargeHistory(client as never, {
      ...baseParams,
      rechargeHistory: [
        item({ planName: '季度会员' }),
        item({ planName: '年度会员' }),
      ],
    });

    const texts = sqlTextsOf(client);
    expect(countBy(texts, 'DELETE')).toBe(0);
    expect(countBy(texts, 'INSERT INTO member_recharge_logs')).toBe(1);
  });

  it('伪造或不匹配的 rc-id 视为新记录，不会误更新他人流水', async () => {
    const client = createClient([{ id: 11, operatorStaffId: 3 }]);

    await replaceMemberRechargeHistory(client as never, {
      ...baseParams,
      rechargeHistory: [
        item({ id: 'rc-999', planName: '季度会员' }),
        item({ id: 'bogus', planName: '年度会员' }),
      ],
    });

    const texts = sqlTextsOf(client);
    expect(countBy(texts, 'UPDATE member_recharge_logs')).toBe(0);
    // 原 id=11 未被请求带回 → 精确删除
    expect(countBy(texts, 'DELETE FROM member_recharge_logs')).toBe(1);
    // 两条都当新增，合并为一次批量插入
    expect(countBy(texts, 'INSERT INTO member_recharge_logs')).toBe(1);
  });

  it('传空数组时按 id 精确删除存量，不做插入', async () => {
    const client = createClient([
      { id: 11, operatorStaffId: 3 },
      { id: 12, operatorStaffId: 4 },
    ]);

    await replaceMemberRechargeHistory(client as never, {
      ...baseParams,
      rechargeHistory: [],
    });

    const texts = sqlTextsOf(client);
    expect(countBy(texts, 'DELETE FROM member_recharge_logs')).toBe(1);
    expect(countBy(texts, 'INSERT INTO member_recharge_logs')).toBe(0);
  });

  it('金额按「元」入站换算成「分」写入', async () => {
    const client = createClient([]);

    await replaceMemberRechargeHistory(client as never, {
      ...baseParams,
      rechargeHistory: [item({ planName: '季度会员', amount: 99 })],
    });

    const values = collectValues(client.$executeRaw.mock.calls[0] as unknown[]);
    expect(values).toContain(9900);
  });
});
