import { ForbiddenException } from '@nestjs/common';
import { EmployeeStatus } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { PlatformMembershipAccessService } from './platform-membership-access.service';

describe('PlatformMembershipAccessService', () => {
  let service: PlatformMembershipAccessService;

  const prismaService = {
    storeMembershipProfile: {
      findUnique: jest.fn(),
    },
    product: {
      count: jest.fn(),
    },
    employee: {
      count: jest.fn(),
    },
    space: {
      count: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-05-23T12:00:00.000Z'));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlatformMembershipAccessService,
        { provide: PrismaService, useValue: prismaService },
      ],
    }).compile();

    service = module.get<PlatformMembershipAccessService>(
      PlatformMembershipAccessService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('免费版商品达到上限时阻止继续新增', async () => {
    prismaService.storeMembershipProfile.findUnique.mockResolvedValue(null);
    prismaService.product.count.mockResolvedValue(3);

    await expect(service.ensureProductQuotaAvailable(18)).rejects.toEqual(
      new ForbiddenException(
        '当前会员套餐最多可录入 3 个商品，请升级会员后继续添加',
      ),
    );
  });

  it('月度会员在职员工未达到上限时允许新增', async () => {
    prismaService.storeMembershipProfile.findUnique.mockResolvedValue({
      currentPlanId: 'monthly',
      startsAt: new Date('2026-05-01T00:00:00.000Z'),
      expiresAt: new Date('2026-06-01T00:00:00.000Z'),
    });
    prismaService.employee.count.mockResolvedValue(4);

    await expect(
      service.ensureEmployeeQuotaAvailable(18),
    ).resolves.toBeUndefined();
    expect(prismaService.employee.count).toHaveBeenCalledWith({
      where: {
        storeId: 18,
        status: EmployeeStatus.active,
      },
    });
  });

  it('免费版会返回近 7 天的历史窗口起点并裁剪范围', async () => {
    prismaService.storeMembershipProfile.findUnique.mockResolvedValue(null);

    await expect(service.getHistoryWindowStart(18)).resolves.toBe(
      new Date(2026, 4, 17, 0, 0, 0, 0).getTime(),
    );
    await expect(
      service.clampHistoryRange(18, {
        start: new Date(2026, 4, 1, 0, 0, 0, 0).getTime(),
        end: new Date(2026, 4, 23, 23, 59, 59, 999).getTime(),
      }),
    ).resolves.toEqual({
      start: new Date(2026, 4, 17, 0, 0, 0, 0).getTime(),
      end: new Date(2026, 4, 23, 23, 59, 59, 999).getTime(),
      clamped: true,
      empty: false,
    });
  });

  it('免费版不允许报表导出', async () => {
    prismaService.storeMembershipProfile.findUnique.mockResolvedValue(null);

    await expect(service.ensureReportExportEnabled(18)).rejects.toEqual(
      new ForbiddenException('当前会员套餐暂不支持报表导出，请升级会员后使用'),
    );
  });

  it('永久会员可继续使用财务能力', async () => {
    prismaService.storeMembershipProfile.findUnique.mockResolvedValue({
      currentPlanId: 'yearly',
      startsAt: new Date('2026-01-01T00:00:00.000Z'),
      expiresAt: null,
    });

    await expect(
      service.ensureFinanceFeatureEnabled(18),
    ).resolves.toBeUndefined();
    await expect(
      service.ensureReportExportEnabled(18),
    ).resolves.toBeUndefined();
    await expect(service.getHistoryWindowStart(18)).resolves.toBeNull();
  });

  it('正式 lifetime 运行态在有效期内沿用永久会员权益', async () => {
    prismaService.storeMembershipProfile.findUnique.mockResolvedValue({
      currentPlanId: 'lifetime',
      startsAt: new Date('2026-05-01T00:00:00.000Z'),
      expiresAt: new Date('2036-05-01T00:00:00.000Z'),
    });

    await expect(
      service.ensureFinanceFeatureEnabled(18),
    ).resolves.toBeUndefined();
    await expect(
      service.ensureReportExportEnabled(18),
    ).resolves.toBeUndefined();
    await expect(service.getHistoryWindowStart(18)).resolves.toBeNull();
  });

  it('缺少 sub_account_quota 字段时回退到旧档案查询', async () => {
    prismaService.storeMembershipProfile.findUnique
      .mockRejectedValueOnce(
        new Error('column "sub_account_quota" does not exist'),
      )
      .mockResolvedValueOnce({
        currentPlanId: 'yearly',
        startsAt: new Date('2026-05-01T00:00:00.000Z'),
        expiresAt: null,
      });

    await expect(service.getSubAccountBenefitSnapshot(18)).resolves.toEqual({
      level: 'lifetime',
      eligible: true,
      quota: 0,
      quotaMax: 10,
      enabled: false,
      rawQuota: 0,
    });
    expect(
      prismaService.storeMembershipProfile.findUnique,
    ).toHaveBeenNthCalledWith(1, {
      where: { storeId: 18 },
      select: {
        currentPlanId: true,
        startsAt: true,
        expiresAt: true,
        subAccountQuota: true,
      },
    });
    expect(
      prismaService.storeMembershipProfile.findUnique,
    ).toHaveBeenNthCalledWith(2, {
      where: { storeId: 18 },
      select: {
        currentPlanId: true,
        startsAt: true,
        expiresAt: true,
      },
    });
  });
});
