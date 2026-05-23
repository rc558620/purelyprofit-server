import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { PulseMembershipSettingsService } from './membership-settings.service';

describe('PulseMembershipSettingsService', () => {
  let service: PulseMembershipSettingsService;

  const prismaService = {
    membershipPlanSetting: {
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
  };

  const developerUser: AuthenticatedUser = {
    id: 101,
    email: 'dev@example.com',
    phone: '13800138000',
    name: '开发者',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    pulseMode: 'normal',
    isPulseDeveloper: true,
    currentMembership: null,
  };

  const normalUser: AuthenticatedUser = {
    ...developerUser,
    isPulseDeveloper: false,
    pulseMode: 'normal',
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PulseMembershipSettingsService,
        { provide: PrismaService, useValue: prismaService },
      ],
    }).compile();

    service = module.get<PulseMembershipSettingsService>(
      PulseMembershipSettingsService,
    );
  });

  it('getSettings 缺失配置时会自动补齐默认套餐', async () => {
    prismaService.membershipPlanSetting.findMany.mockResolvedValue([
      {
        planId: 'monthly',
        planName: '月度会员',
        price: 3800,
        validDays: null,
        updatedAt: new Date('2026-05-21T00:00:00.000Z'),
      },
    ]);
    prismaService.membershipPlanSetting.upsert.mockImplementation(
      async ({ where }: { where: { planId: string } }) => {
        switch (where.planId) {
          case 'monthly':
            return {
              planId: 'monthly',
              planName: '月度会员',
              price: 3800,
              validDays: null,
              updatedAt: new Date('2026-05-21T00:00:00.000Z'),
            };
          case 'quarterly':
            return {
              planId: 'quarterly',
              planName: '季度会员',
              price: 9900,
              validDays: null,
              updatedAt: new Date('2026-05-21T00:00:01.000Z'),
            };
          case 'yearly':
            return {
              planId: 'yearly',
              planName: '年度会员',
              price: 36900,
              validDays: null,
              updatedAt: new Date('2026-05-21T00:00:02.000Z'),
            };
          default:
            return {
              planId: 'lifetime',
              planName: '永久会员',
              price: 39800,
              validDays: 730,
              updatedAt: new Date('2026-05-21T00:00:03.000Z'),
            };
        }
      },
    );

    await expect(service.getSettings(developerUser)).resolves.toEqual({
      items: [
        {
          planId: 'monthly',
          planName: '月度会员',
          price: 3800,
          validDays: null,
          updatedAt: new Date('2026-05-21T00:00:00.000Z').getTime(),
        },
        {
          planId: 'quarterly',
          planName: '季度会员',
          price: 9900,
          validDays: null,
          updatedAt: new Date('2026-05-21T00:00:01.000Z').getTime(),
        },
        {
          planId: 'yearly',
          planName: '年度会员',
          price: 36900,
          validDays: null,
          updatedAt: new Date('2026-05-21T00:00:02.000Z').getTime(),
        },
        {
          planId: 'lifetime',
          planName: '永久会员',
          price: 39800,
          validDays: 730,
          updatedAt: new Date('2026-05-21T00:00:03.000Z').getTime(),
        },
      ],
    });
    expect(prismaService.membershipPlanSetting.upsert).toHaveBeenCalledTimes(4);
  });

  it('updateLifetime 会更新永久会员价格和有效期', async () => {
    prismaService.membershipPlanSetting.upsert.mockResolvedValue({
      planId: 'lifetime',
      planName: '永久会员',
      price: 58800,
      validDays: 7200,
      updatedAt: new Date('2026-05-22T08:00:00.000Z'),
    });

    await expect(
      service.updateLifetime(developerUser, {
        price: 58800,
        validDays: 7200,
      }),
    ).resolves.toEqual({
      planId: 'lifetime',
      planName: '永久会员',
      price: 58800,
      validDays: 7200,
      updatedAt: new Date('2026-05-22T08:00:00.000Z').getTime(),
    });
  });

  it('非开发者不可维护会员套餐配置', async () => {
    await expect(service.getSettings(normalUser)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prismaService.membershipPlanSetting.findMany).not.toHaveBeenCalled();
  });
});
