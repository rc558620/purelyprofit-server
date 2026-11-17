import type { Prisma } from '@prisma/client';
import {
  buildCustomerMergeStatements,
  buildMemberMergeStatements,
} from './club-account-merge.statements';

const NOW = new Date('2026-11-16T00:00:00.000Z');

const sqlText = (statement: Prisma.Sql): string => statement.strings.join('?');

describe('账号合并批量语句', () => {
  it('没有可合并的档案时一条语句都不发', () => {
    expect(buildMemberMergeStatements([], NOW)).toEqual([]);
    expect(buildCustomerMergeStatements([], NOW)).toEqual([]);
  });

  it('Member：豆结转 + 软删各一条，参数逐行对齐（目标 id / 豆数 / 源 id）', () => {
    const statements = buildMemberMergeStatements(
      [
        { targetId: 2, sourceId: 1, beanBalance: 7 },
        { targetId: 42, sourceId: 41, beanBalance: 3 },
      ],
      NOW,
    );

    expect(statements).toHaveLength(2);
    expect(sqlText(statements[0]!)).toContain('UPDATE "members" AS m');
    expect(sqlText(statements[0]!)).toContain(
      '"bean_balance" + v."bean_balance"',
    );
    // VALUES 里每一对都是 (目标 id, 结转豆数)，不拼接字符串
    expect(statements[0]!.values).toEqual(
      expect.arrayContaining([2, 7, 42, 3]),
    );

    expect(sqlText(statements[1]!)).toContain('"phone" = NULL');
    expect(sqlText(statements[1]!)).toContain('"deleted_at" =');
    expect(statements[1]!.values).toEqual(expect.arrayContaining([1, 41]));
    expect(statements[1]!.values).toContain(NOW);
  });

  it('Member：纯利豆为 0 的源档案不参与结转（与改造前 if (beanBalance > 0) 一致）', () => {
    const statements = buildMemberMergeStatements(
      [{ targetId: 2, sourceId: 1, beanBalance: 0 }],
      NOW,
    );

    // 只剩软删一条
    expect(statements).toHaveLength(1);
    expect(sqlText(statements[0]!)).toContain('"phone" = NULL');
  });

  it('MarketingCustomer：资产并入 + 软删各一条，5 个资产字段逐列相加', () => {
    const statements = buildCustomerMergeStatements(
      [
        {
          targetId: 20,
          sourceId: 10,
          balance: 645_070,
          points: 30,
          totalSpent: 9_000,
          visitCount: 2,
        },
      ],
      NOW,
    );

    expect(statements).toHaveLength(2);
    const merge = sqlText(statements[0]!);
    expect(merge).toContain('UPDATE "marketing_customers" AS c');
    for (const column of [
      '"balance"',
      '"points"',
      '"total_spent"',
      '"visit_count"',
    ]) {
      expect(merge).toContain(`${column} + v.`);
    }
    expect(statements[0]!.values).toEqual(
      expect.arrayContaining([20, 645_070, 30, 9_000, 2]),
    );

    const softDelete = sqlText(statements[1]!);
    expect(softDelete).toContain('"club_user_id" = NULL');
    expect(softDelete).toContain('"phone" = NULL');
    expect(statements[1]!.values).toEqual(expect.arrayContaining([10]));
  });

  it('门店数量翻倍不增加语句数（事务时长与门店数解耦）', () => {
    const one = buildMemberMergeStatements(
      [{ targetId: 2, sourceId: 1, beanBalance: 1 }],
      NOW,
    );
    const ten = buildMemberMergeStatements(
      Array.from({ length: 10 }, (_, index) => ({
        targetId: index * 2 + 2,
        sourceId: index * 2 + 1,
        beanBalance: 1,
      })),
      NOW,
    );

    expect(ten).toHaveLength(one.length);
    const customersOne = buildCustomerMergeStatements(
      [
        {
          targetId: 2,
          sourceId: 1,
          balance: 0,
          points: 0,
          totalSpent: 0,
          visitCount: 0,
        },
      ],
      NOW,
    );
    const customersTen = buildCustomerMergeStatements(
      Array.from({ length: 10 }, (_, index) => ({
        targetId: index * 2 + 2,
        sourceId: index * 2 + 1,
        balance: 0,
        points: 0,
        totalSpent: 0,
        visitCount: 0,
      })),
      NOW,
    );
    expect(customersTen).toHaveLength(customersOne.length);
  });
});
