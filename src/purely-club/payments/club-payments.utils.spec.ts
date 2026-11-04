// 回调金额一致性校验：全部落账链路共用的唯一资金闸门
import { BadRequestException } from '@nestjs/common';
import {
  assertClubPaymentAmountMatches,
  assertClubPaymentAmountMatchesAllowZero,
  assertClubPaymentAmountsMatch,
} from './club-payments.utils';

describe('assertClubPaymentAmountMatches', () => {
  it('金额一致时不抛错', () => {
    expect(() => assertClubPaymentAmountMatches(5000, 5000)).not.toThrow();
  });

  it('金额不一致时抛出业务异常', () => {
    expect(() => assertClubPaymentAmountMatches(5000, 4999)).toThrow(
      BadRequestException,
    );
  });

  // 0 / 负数一定是异常数据：0 元订单走独立链路，不能落进通用校验
  it.each([0, -1])('本地金额为 %i 时抛出业务异常', (amountFen) => {
    expect(() => assertClubPaymentAmountMatches(amountFen, 5000)).toThrow(
      BadRequestException,
    );
  });

  it.each([0, -1])('回调金额为 %i 时抛出业务异常', (amountFen) => {
    expect(() => assertClubPaymentAmountMatches(5000, amountFen)).toThrow(
      BadRequestException,
    );
  });
});

describe('assertClubPaymentAmountMatchesAllowZero', () => {
  // 全额积分抵扣的免费券 / 零元卡：双方都是 0 属合法场景
  it('双方都为 0 时放行', () => {
    expect(() => assertClubPaymentAmountMatchesAllowZero(0, 0)).not.toThrow();
  });

  it('本地 0 元但回调有金额时拒绝', () => {
    expect(() => assertClubPaymentAmountMatchesAllowZero(0, 5000)).toThrow(
      BadRequestException,
    );
  });

  it('负数仍然视为异常', () => {
    expect(() => assertClubPaymentAmountMatchesAllowZero(-1, 0)).toThrow(
      BadRequestException,
    );
  });
});

describe('assertClubPaymentAmountsMatch', () => {
  it('全部金额一致时不抛错', () => {
    expect(() =>
      assertClubPaymentAmountsMatch(5000, [5000, 5000]),
    ).not.toThrow();
  });

  // 事务内二次校验：流水金额或订单应付金额任一不符都不能落账
  it('任一金额不一致时抛出业务异常', () => {
    expect(() => assertClubPaymentAmountsMatch(5000, [5000, 4999])).toThrow(
      BadRequestException,
    );
  });

  it('空列表时不做任何校验', () => {
    expect(() => assertClubPaymentAmountsMatch(5000, [])).not.toThrow();
  });
});
