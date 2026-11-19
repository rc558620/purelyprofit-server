import { BadRequestException } from '@nestjs/common';
import type { MemberCardPlan } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type { MarketingSharedService } from '../../marketing/marketing-shared.service';
import { MemberCardPlansService } from './member-card-plans.service';
import type { CreateMemberCardPlanDto } from './dto/member-card-plan.dto';

const createPlanRow = (
  patch: Partial<MemberCardPlan> = {},
): MemberCardPlan => ({
  id: 11,
  storeId: 3,
  name: '次卡',
  kind: 'times',
  price: 10000,
  originalPrice: null,
  validDays: 30,
  totalTimes: 5,
  perUseTimes: 2,
  usableSpaceTypes: [],
  usableWeekdays: [],
  maxGuestPerUse: null,
  purchaseLimit: null,
  isActive: true,
  deletedAt: null,
  createdAt: new Date('2026-01-01T00:00:00+08:00'),
  updatedAt: new Date('2026-01-01T00:00:00+08:00'),
  ...patch,
});

const createService = (prisma: Record<string, unknown>) => {
  const shared = {
    ensureMarketingStoreAccess: jest.fn().mockResolvedValue(undefined),
    resolveMembershipManagedStoreId: jest.fn().mockResolvedValue(3),
  } as unknown as MarketingSharedService;

  return {
    service: new MemberCardPlansService(
      prisma as unknown as PrismaService,
      shared,
    ),
    shared,
  };
};

const user = {} as AuthenticatedUser;

describe('MemberCardPlansService - 单次扣减不得超过总次数', () => {
  it('新建时 perUseTimes > totalTimes 直接拒绝，不落库', async () => {
    const create = jest.fn();
    const findFirst = jest.fn().mockResolvedValue(null);
    const { service } = createService({
      memberCardPlan: { create, findFirst },
    });

    const dto: CreateMemberCardPlanDto = {
      name: '不可用次卡',
      kind: 'times',
      price: 100,
      validDays: 30,
      totalTimes: 3,
      perUseTimes: 4,
    };

    await expect(service.createPlan(user, 3, dto)).rejects.toThrow(
      BadRequestException,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('编辑时把总次数调到低于单次扣减也拒绝', async () => {
    const update = jest.fn();
    const findFirst = jest
      .fn()
      .mockResolvedValue(createPlanRow({ totalTimes: 5, perUseTimes: 3 }));
    const { service } = createService({
      memberCardPlan: { update, findFirst },
      memberCard: { count: jest.fn().mockResolvedValue(0) },
      memberCardOrder: { count: jest.fn().mockResolvedValue(0) },
    });

    await expect(
      service.updatePlan(user, 11, { totalTimes: 1 }),
    ).rejects.toThrow(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('时长卡不参与关系校验（totalTimes 为空）', async () => {
    const findFirst = jest
      .fn()
      .mockResolvedValue(
        createPlanRow({ kind: 'monthly', totalTimes: null, perUseTimes: 3 }),
      );
    const update = jest
      .fn()
      .mockResolvedValue(
        createPlanRow({ kind: 'monthly', totalTimes: null, perUseTimes: 3 }),
      );
    const groupBy = jest.fn().mockResolvedValue([]);
    const { service } = createService({
      memberCardPlan: { update, findFirst },
      memberCardOrder: { groupBy },
    });

    await expect(
      service.updatePlan(user, 11, { totalTimes: null }),
    ).resolves.toBeDefined();
    expect(update).toHaveBeenCalled();
  });
});

describe('MemberCardPlansService - 已售卡锁定权益配置', () => {
  it('已有售出卡时拒绝修改权益字段', async () => {
    const update = jest.fn();
    const { service } = createService({
      memberCardPlan: {
        findFirst: jest
          .fn()
          .mockResolvedValue(createPlanRow({ validDays: 30 })),
        update,
      },
      memberCard: { count: jest.fn().mockResolvedValue(1) },
      memberCardOrder: { count: jest.fn().mockResolvedValue(0) },
    });

    await expect(
      service.updatePlan(user, 11, { validDays: 60 }),
    ).rejects.toThrow('已有售出卡或待支付订单');
    expect(update).not.toHaveBeenCalled();
  });

  it('已有售出卡时仍允许改价、改名与上下架', async () => {
    const plan = createPlanRow();
    const update = jest.fn().mockResolvedValue({ ...plan, price: 12000 });
    const { service } = createService({
      memberCardPlan: {
        findFirst: jest.fn().mockResolvedValue(plan),
        update,
      },
      memberCard: { count: jest.fn().mockResolvedValue(1) },
      memberCardOrder: {
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
      },
    });

    await expect(
      service.updatePlan(user, 11, { price: 120 }),
    ).resolves.toBeDefined();
    expect(update).toHaveBeenCalled();
  });
});
