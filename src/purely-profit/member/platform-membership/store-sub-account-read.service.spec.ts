import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { StoreSubAccountRole, StoreSubAccountStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { PlatformMembershipAccessService } from './platform-membership-access.service';
import { StoreSubAccountReadService } from './store-sub-account-read.service';

describe('StoreSubAccountReadService', () => {
  let service: StoreSubAccountReadService;

  const prismaService = {
    storeSubAccount: {
      findMany: jest.fn(),
    },
  };

  const membershipAccessService = {
    getSubAccountBenefitSnapshot: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    membershipAccessService.getSubAccountBenefitSnapshot.mockResolvedValue({
      level: 'yearly',
      eligible: true,
      quota: 2,
      quotaMax: 10,
      enabled: true,
      rawQuota: 2,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StoreSubAccountReadService,
        { provide: PrismaService, useValue: prismaService },
        {
          provide: PlatformMembershipAccessService,
          useValue: membershipAccessService,
        },
      ],
    }).compile();

    service = module.get<StoreSubAccountReadService>(
      StoreSubAccountReadService,
    );
  });

  it('返回门店子账号汇总与角色统计', async () => {
    prismaService.storeSubAccount.findMany.mockResolvedValue([
      {
        id: 11,
        slotIndex: 1,
        role: StoreSubAccountRole.cashier,
        status: StoreSubAccountStatus.active,
        isAssigned: true,
        employeeId: 101,
        canUseHandover: true,
        canAccessHome: true,
        employee: {
          id: 101,
          name: '小张',
        },
      },
      {
        id: 12,
        slotIndex: 2,
        role: StoreSubAccountRole.manager,
        status: StoreSubAccountStatus.inactive,
        isAssigned: false,
        employeeId: null,
        canUseHandover: false,
        canAccessHome: false,
        employee: null,
      },
    ]);

    await expect(service.getStoreSubAccountSummary(18)).resolves.toEqual({
      quota: 2,
      usedCount: 1,
      availableCount: 1,
      roleSummary: [
        {
          role: StoreSubAccountRole.cashier,
          activeCount: 1,
          inactiveCount: 0,
          disabledCount: 0,
          assignedCount: 1,
        },
        {
          role: StoreSubAccountRole.finance,
          activeCount: 0,
          inactiveCount: 0,
          disabledCount: 0,
          assignedCount: 0,
        },
        {
          role: StoreSubAccountRole.manager,
          activeCount: 0,
          inactiveCount: 1,
          disabledCount: 0,
          assignedCount: 0,
        },
      ],
      slots: [
        {
          id: 11,
          slotIndex: 1,
          role: StoreSubAccountRole.cashier,
          status: StoreSubAccountStatus.active,
          isAssigned: true,
          employeeId: 101,
          employeeName: '小张',
          canUseHandover: true,
          canAccessHome: true,
        },
        {
          id: 12,
          slotIndex: 2,
          role: StoreSubAccountRole.manager,
          status: StoreSubAccountStatus.inactive,
          isAssigned: false,
          employeeId: null,
          employeeName: null,
          canUseHandover: false,
          canAccessHome: false,
        },
      ],
    });
    expect(prismaService.storeSubAccount.findMany).toHaveBeenCalledWith({
      where: { storeId: 18 },
      select: {
        id: true,
        slotIndex: true,
        role: true,
        status: true,
        isAssigned: true,
        employeeId: true,
        canUseHandover: true,
        canAccessHome: true,
        employee: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: [{ slotIndex: 'asc' }],
    });
  });

  it('缺少 store_sub_accounts schema 时拒绝请求，避免返回空汇总', async () => {
    prismaService.storeSubAccount.findMany.mockRejectedValueOnce(
      new Error('relation "store_sub_accounts" does not exist'),
    );

    await expect(service.getStoreSubAccountSummary(18)).rejects.toEqual(
      new UnauthorizedException(
        '子账号能力上下文未就绪，请联系管理员完成系统升级后重试',
      ),
    );
  });
});
