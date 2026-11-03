import { BadRequestException } from '@nestjs/common';

import { Money } from '../../../shared/money.utils';
import type { CheckoutSettlementItemDto } from './dto/space-session.dto';
import {
  assertExpectedPayableMatches,
  normalizeCheckoutSettlements,
  planCheckoutSettlements,
} from './space-session-checkout-settlement.shared';
import type { CheckoutSettlementInput } from './space-sessions.types';

const createPlanParams = (params: {
  /** 抵扣前应收（元） */
  basePayable: number;
  /** 台位费（元） */
  timeCost?: number;
  /** 商品费（元） */
  itemsCost?: number;
  settlements?: CheckoutSettlementInput[];
  customerBalanceCents?: number | null;
}) => ({
  basePayableMoney: Money.fromInputYuan(params.basePayable),
  timeCostMoney: Money.fromInputYuan(params.timeCost ?? 0),
  itemsCostMoney: Money.fromInputYuan(params.itemsCost ?? 0),
  settlements: params.settlements ?? [],
  customerBalanceCents:
    params.customerBalanceCents === undefined
      ? null
      : params.customerBalanceCents,
});

describe('planCheckoutSettlements', () => {
  it('无抵扣时应付等于抵扣前应收', () => {
    const plan = planCheckoutSettlements(
      createPlanParams({ basePayable: 120, timeCost: 100, itemsCost: 20 }),
    );

    expect(plan.cardDeductionMoney.toOutputYuan()).toBe(0);
    expect(plan.voucherDeductionMoney.toOutputYuan()).toBe(0);
    expect(plan.balanceDeductionMoney.toOutputYuan()).toBe(0);
    expect(plan.payableMoney.toOutputYuan()).toBe(120);
  });

  it('卡抵台位费 + 券抵商品 + 余额抵剩余应付，应付逐级收敛', () => {
    const plan = planCheckoutSettlements(
      createPlanParams({
        basePayable: 150,
        timeCost: 100,
        itemsCost: 50,
        customerBalanceCents: 5000,
        settlements: [
          {
            kind: 'member_card',
            target: 'time_fee',
            assetId: '8',
            amount: 100,
          },
          { kind: 'voucher', target: 'items', assetId: 'VC-1', amount: 30 },
          { kind: 'balance', target: 'total', amount: 20 },
        ],
      }),
    );

    expect(plan.cardDeductionMoney.toOutputYuan()).toBe(100);
    expect(plan.voucherDeductionMoney.toOutputYuan()).toBe(30);
    expect(plan.balanceDeductionMoney.toOutputYuan()).toBe(20);
    expect(plan.payableMoney.toOutputYuan()).toBe(0);
  });

  it('会员卡抵扣超过台位费时拒绝（卡只能抵台位费）', () => {
    expect(() =>
      planCheckoutSettlements(
        createPlanParams({
          basePayable: 200,
          timeCost: 100,
          itemsCost: 100,
          settlements: [
            {
              kind: 'member_card',
              target: 'time_fee',
              assetId: '8',
              amount: 120,
            },
          ],
        }),
      ),
    ).toThrow(BadRequestException);
  });

  it('团购券抵扣超过商品费时拒绝', () => {
    expect(() =>
      planCheckoutSettlements(
        createPlanParams({
          basePayable: 100,
          timeCost: 0,
          itemsCost: 20,
          settlements: [
            { kind: 'voucher', target: 'items', assetId: 'VC-1', amount: 30 },
          ],
        }),
      ),
    ).toThrow(BadRequestException);
  });

  it('储值余额抵扣超过可用余额时拒绝', () => {
    expect(() =>
      planCheckoutSettlements(
        createPlanParams({
          basePayable: 100,
          timeCost: 0,
          itemsCost: 100,
          customerBalanceCents: 500,
          settlements: [{ kind: 'balance', target: 'total', amount: 6 }],
        }),
      ),
    ).toThrow(BadRequestException);
  });

  it('未识别会员时余额抵扣一律拒绝', () => {
    expect(() =>
      planCheckoutSettlements(
        createPlanParams({
          basePayable: 100,
          timeCost: 0,
          itemsCost: 100,
          customerBalanceCents: null,
          settlements: [{ kind: 'balance', target: 'total', amount: 1 }],
        }),
      ),
    ).toThrow(BadRequestException);
  });

  it('台位费为负（历史抵扣）时卡抵扣额度按 0 处理而不是全额可用', () => {
    const plan = planCheckoutSettlements(
      createPlanParams({ basePayable: 0, timeCost: -10, itemsCost: 0 }),
    );

    expect(plan.cardDeductionMoney.toOutputYuan()).toBe(0);
    expect(plan.payableMoney.toOutputYuan()).toBe(0);
  });
});

describe('assertExpectedPayableMatches', () => {
  it('后端应付与前端预期一致时通过', () => {
    expect(() =>
      assertExpectedPayableMatches({
        expectedPayable: 20,
        payableMoney: Money.fromInputYuan(20),
      }),
    ).not.toThrow();
  });

  it('金额不一致时拒绝，提示重新预览', () => {
    expect(() =>
      assertExpectedPayableMatches({
        expectedPayable: 20,
        payableMoney: Money.fromInputYuan(21),
      }),
    ).toThrow(BadRequestException);
  });

  it('未提供预期应付（自动结账）时跳过比对', () => {
    expect(() =>
      assertExpectedPayableMatches({
        payableMoney: Money.fromInputYuan(21),
      }),
    ).not.toThrow();
  });
});

describe('normalizeCheckoutSettlements', () => {
  const createItem = (
    patch: Partial<CheckoutSettlementItemDto>,
  ): CheckoutSettlementItemDto =>
    ({
      kind: 'member_card',
      target: 'time_fee',
      assetId: '8',
      amount: 10,
      ...patch,
    }) as CheckoutSettlementItemDto;

  it('去除标识空白并保留合法明细', () => {
    const normalized = normalizeCheckoutSettlements([
      createItem({ assetId: ' 8 ', assetLabel: ' 年卡 ' }),
    ]);

    expect(normalized).toEqual([
      {
        kind: 'member_card',
        target: 'time_fee',
        assetId: '8',
        assetLabel: '年卡',
        amount: 10,
      },
    ]);
  });

  it('资产类型与作用对象不匹配时拒绝（券不能抵台位费）', () => {
    expect(() =>
      normalizeCheckoutSettlements([
        createItem({ kind: 'voucher', target: 'time_fee', assetId: 'VC-1' }),
      ]),
    ).toThrow(BadRequestException);
  });

  it('同类资产重复出现时拒绝', () => {
    expect(() =>
      normalizeCheckoutSettlements([createItem({}), createItem({})]),
    ).toThrow(BadRequestException);
  });

  it('会员卡缺少持卡实例 ID 时拒绝', () => {
    expect(() =>
      normalizeCheckoutSettlements([createItem({ assetId: undefined })]),
    ).toThrow(BadRequestException);
  });

  it('缺省明细返回空数组', () => {
    expect(normalizeCheckoutSettlements(undefined)).toEqual([]);
  });
});
