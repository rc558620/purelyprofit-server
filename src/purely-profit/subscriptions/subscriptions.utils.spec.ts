import { BadRequestException } from '@nestjs/common';
import { SubscriptionPlanCode } from '@prisma/client';
import { resolvePlanSnapshot } from './subscriptions.utils';

describe('resolvePlanSnapshot', () => {
  it('STARTER 套餐返回正确的快照', () => {
    const result = resolvePlanSnapshot(SubscriptionPlanCode.STARTER);
    expect(result).toEqual({ planName: '基础版', maxAccountSeats: 1 });
  });

  it('GROWTH 套餐返回正确的快照', () => {
    const result = resolvePlanSnapshot(SubscriptionPlanCode.GROWTH);
    expect(result).toEqual({ planName: '成长版', maxAccountSeats: 2 });
  });

  it('PRO 套餐返回正确的快照', () => {
    const result = resolvePlanSnapshot(SubscriptionPlanCode.PRO);
    expect(result).toEqual({ planName: '专业版', maxAccountSeats: 3 });
  });

  it('CUSTOM 套餐传入合法席位数时返回自定义快照', () => {
    const result = resolvePlanSnapshot(SubscriptionPlanCode.CUSTOM, 5);
    expect(result).toEqual({ planName: '5 账号版', maxAccountSeats: 5 });
  });

  it('CUSTOM 套餐未传席位数时抛出 BadRequestException', () => {
    expect(() => resolvePlanSnapshot(SubscriptionPlanCode.CUSTOM)).toThrow(
      BadRequestException,
    );
    expect(() => resolvePlanSnapshot(SubscriptionPlanCode.CUSTOM)).toThrow(
      '自定义套餐必须提供大于等于 1 的席位数',
    );
  });

  it('CUSTOM 套餐传入席位数 0 时抛出 BadRequestException', () => {
    expect(() => resolvePlanSnapshot(SubscriptionPlanCode.CUSTOM, 0)).toThrow(
      BadRequestException,
    );
  });

  it('CUSTOM 套餐传入负数席位数时抛出 BadRequestException', () => {
    expect(() => resolvePlanSnapshot(SubscriptionPlanCode.CUSTOM, -1)).toThrow(
      BadRequestException,
    );
  });

  it('CUSTOM 套餐传入席位数 1 时返回合法快照', () => {
    const result = resolvePlanSnapshot(SubscriptionPlanCode.CUSTOM, 1);
    expect(result).toEqual({ planName: '1 账号版', maxAccountSeats: 1 });
  });
});
