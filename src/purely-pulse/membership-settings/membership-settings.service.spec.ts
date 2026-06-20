import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { PulseMembershipSettingsAccessService } from './membership-settings-access.service';
import { PulseMembershipSettingsProfileService } from './membership-settings-profile.service';
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

  const allPlanSettings = [
    {
      planId: 'monthly',
      planName: '月度会员',
      price: 3800,
      validDays: null,
      updatedAt: new Date('2026-05-21T00:00:00.000Z'),
    },
    {
      planId: 'quarterly',
      planName: '季度会员',
      price: 9900,
      validDays: null,
      updatedAt: new Date('2026-05-21T00:00:01.000Z'),
    },
    {
      planId: 'yearly',
      planName: '年度会员',
      price: 36900,
      validDays: null,
      updatedAt: new Date('2026-05-21T00:00:02.000Z'),
    },
    {
      planId: 'lifetime',
      planName: '永久会员',
      price: 39800,
      validDays: 730,
      updatedAt: new Date('2026-05-21T00:00:03.000Z'),
    },
  ];

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PulseMembershipSettingsService,
        PulseMembershipSettingsAccessService,
        PulseMembershipSettingsProfileService,
        { provide: PrismaService, useValue: prismaService },
      ],
    }).compile();

    service = module.get<PulseMembershipSettingsService>(
      PulseMembershipSettingsService,
    );
  });

  it('getSettings 全部配置存在时直接返回', async () => {
    prismaService.membershipPlanSetting.findMany.mockResolvedValue(
      allPlanSettings,
    );

    await expect(service.getSettings(developerUser)).resolves.toEqual({
      items: allPlanSettings.map((s) => ({
        planId: s.planId,
        planName: s.planName,
        price: s.price,
        validDays: s.validDays,
        updatedAt: s.updatedAt.getTime(),
      })),
    });
    expect(prismaService.membershipPlanSetting.upsert).not.toHaveBeenCalled();
  });

  it('getSettings 缺失配置时仅补齐缺失的套餐，不覆盖已有记录', async () => {
    // 第一次 findMany 只返回 monthly（缺失 3 个）
    // 第二次 findMany 返回全部（补齐后重新查询）
    prismaService.membershipPlanSetting.findMany
      .mockResolvedValueOnce([allPlanSettings[0]])
      .mockResolvedValueOnce(allPlanSettings);

    prismaService.membershipPlanSetting.upsert.mockImplementation(
      ({ where }: { where: { planId: string } }) => {
        switch (where.planId) {
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
      items: allPlanSettings.map((s) => ({
        planId: s.planId,
        planName: s.planName,
        price: s.price,
        validDays: s.validDays,
        updatedAt: s.updatedAt.getTime(),
      })),
    });
    // 只对缺失的 3 个 planId 执行 upsert，不覆盖已存在的 monthly
    expect(prismaService.membershipPlanSetting.upsert).toHaveBeenCalledTimes(3);
    expect(prismaService.membershipPlanSetting.upsert).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: { planId: 'monthly' },
      }),
    );
  });

  it('getSettings 保留用户已修改的价格，补齐时不覆盖', async () => {
    const modifiedMonthly = {
      ...allPlanSettings[0],
      price: 5800, // 用户修改过的价格
    };
    // 第一次 findMany：monthly 是用户修改的价格，缺 3 个
    prismaService.membershipPlanSetting.findMany
      .mockResolvedValueOnce([modifiedMonthly])
      .mockResolvedValueOnce([modifiedMonthly, ...allPlanSettings.slice(1)]);

    prismaService.membershipPlanSetting.upsert.mockImplementation(
      ({ where }: { where: { planId: string } }) => {
        switch (where.planId) {
          case 'quarterly':
            return allPlanSettings[1];
          case 'yearly':
            return allPlanSettings[2];
          default:
            return allPlanSettings[3];
        }
      },
    );

    const result = await service.getSettings(developerUser);
    // monthly 的价格应保留用户修改值 5800，而非默认值 3800
    expect(result.items[0]).toEqual({
      planId: 'monthly',
      planName: '月度会员',
      price: 5800,
      validDays: null,
      updatedAt: modifiedMonthly.updatedAt.getTime(),
    });
    // upsert 不应被调用于 monthly
    expect(prismaService.membershipPlanSetting.upsert).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: { planId: 'monthly' },
      }),
    );
  });

  it('updateMonthly 会更新月度会员价格', async () => {
    prismaService.membershipPlanSetting.upsert.mockResolvedValue({
      planId: 'monthly',
      planName: '月度会员',
      price: 4800,
      validDays: null,
      updatedAt: new Date('2026-05-22T08:00:00.000Z'),
    });

    await expect(
      service.updateMonthly(developerUser, { price: 4800 }),
    ).resolves.toEqual({
      planId: 'monthly',
      planName: '月度会员',
      price: 4800,
      validDays: null,
      updatedAt: new Date('2026-05-22T08:00:00.000Z').getTime(),
    });
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

  it('updateLifetime 支持只更新价格不改有效期', async () => {
    prismaService.membershipPlanSetting.upsert.mockResolvedValue({
      planId: 'lifetime',
      planName: '永久会员',
      price: 49800,
      validDays: 730,
      updatedAt: new Date('2026-05-22T08:00:00.000Z'),
    });

    await expect(
      service.updateLifetime(developerUser, {
        price: 49800,
      }),
    ).resolves.toEqual({
      planId: 'lifetime',
      planName: '永久会员',
      price: 49800,
      validDays: 730,
      updatedAt: new Date('2026-05-22T08:00:00.000Z').getTime(),
    });

    // 验证 upsert 调用中 validDays 为 undefined，不会覆盖
    expect(prismaService.membershipPlanSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { planId: 'lifetime' },
      }),
    );
  });

  it('非开发者不可查看会员套餐配置', async () => {
    await expect(service.getSettings(normalUser)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prismaService.membershipPlanSetting.findMany).not.toHaveBeenCalled();
  });

  it('非开发者不可更新会员套餐配置', async () => {
    await expect(
      service.updateMonthly(normalUser, { price: 4800 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prismaService.membershipPlanSetting.upsert).not.toHaveBeenCalled();
  });
});
