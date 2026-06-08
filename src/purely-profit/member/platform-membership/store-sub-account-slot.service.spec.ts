import { BadRequestException, NotFoundException } from '@nestjs/common';
import { StoreSubAccountRole, StoreSubAccountStatus } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { PlatformMembershipAccessService } from './platform-membership-access.service';
import { StoreSubAccountLoginService } from './store-sub-account-login.service';
import { StoreSubAccountReadService } from './store-sub-account-read.service';
import { StoreSubAccountSlotService } from './store-sub-account-slot.service';

describe('StoreSubAccountSlotService', () => {
  let service: StoreSubAccountSlotService;
  let prismaService: {
    employee: {
      findFirst: jest.Mock;
    };
    storeSubAccount: {
      upsert: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let membershipAccessService: {
    getSubAccountBenefitSnapshot: jest.Mock;
    ensureSubAccountConfigurable: jest.Mock;
  };
  let storeSubAccountLoginService: {
    ensureEmployeeHasLoginAccount: jest.Mock;
  };
  let storeSubAccountReadService: {
    getStoreSubAccountSummary: jest.Mock;
  };

  beforeEach(async () => {
    const mockPrismaService = {
      employee: {
        findFirst: jest.fn(),
      },
      storeSubAccount: {
        upsert: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    const mockMembershipAccessService = {
      getSubAccountBenefitSnapshot: jest.fn(),
      ensureSubAccountConfigurable: jest.fn(),
    };

    const mockStoreSubAccountLoginService = {
      ensureEmployeeHasLoginAccount: jest.fn(),
    };

    const mockStoreSubAccountReadService = {
      getStoreSubAccountSummary: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StoreSubAccountSlotService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: PlatformMembershipAccessService,
          useValue: mockMembershipAccessService,
        },
        {
          provide: StoreSubAccountLoginService,
          useValue: mockStoreSubAccountLoginService,
        },
        {
          provide: StoreSubAccountReadService,
          useValue: mockStoreSubAccountReadService,
        },
      ],
    }).compile();

    service = module.get<StoreSubAccountSlotService>(
      StoreSubAccountSlotService,
    );
    prismaService = module.get(PrismaService);
    membershipAccessService = module.get(PlatformMembershipAccessService);
    storeSubAccountLoginService = module.get(StoreSubAccountLoginService);
    storeSubAccountReadService = module.get(StoreSubAccountReadService);
  });

  describe('updateQuota', () => {
    it('应同步 quota、槽位和审计记录', async () => {
      const tx = {
        storeMembershipProfile: {
          upsert: jest.fn().mockResolvedValue(undefined),
        },
        storeSubAccount: {
          findMany: jest
            .fn()
            .mockResolvedValue([
              { slotIndex: 1 },
              { slotIndex: 4 },
              { slotIndex: 5 },
            ]),
          update: jest.fn().mockResolvedValue(undefined),
          create: jest.fn().mockResolvedValue(undefined),
          updateMany: jest.fn().mockResolvedValue(undefined),
        },
        storeSubAccountQuotaAudit: {
          create: jest.fn().mockResolvedValue(undefined),
        },
      };
      const summary = {
        quota: 2,
        usedCount: 1,
        availableCount: 1,
        roleSummary: [],
        slots: [],
      };
      membershipAccessService.ensureSubAccountConfigurable.mockResolvedValue(
        undefined,
      );
      membershipAccessService.getSubAccountBenefitSnapshot.mockResolvedValue({
        rawQuota: 5,
      });
      prismaService.$transaction.mockImplementation(async (callback) =>
        callback(tx),
      );
      storeSubAccountReadService.getStoreSubAccountSummary.mockResolvedValue(
        summary,
      );

      await expect(service.updateQuota(1, 2, 99, ' trim me ')).resolves.toEqual(
        summary,
      );
      expect(
        membershipAccessService.ensureSubAccountConfigurable,
      ).toHaveBeenCalledWith(1, 2);
      expect(tx.storeMembershipProfile.upsert).toHaveBeenCalledWith({
        where: { storeId: 1 },
        create: {
          storeId: 1,
          subAccountQuota: 2,
          totalPoints: 0,
          availablePoints: 0,
        },
        update: {
          subAccountQuota: 2,
        },
      });
      expect(tx.storeSubAccount.update).toHaveBeenCalledWith({
        where: {
          storeId_slotIndex: {
            storeId: 1,
            slotIndex: 1,
          },
        },
        data: {
          status: StoreSubAccountStatus.active,
          canAccessHome: true,
        },
      });
      expect(tx.storeSubAccount.create).toHaveBeenCalledTimes(1);
      expect(tx.storeSubAccount.create).toHaveBeenCalledWith({
        data: {
          storeId: 1,
          slotIndex: 2,
          role: StoreSubAccountRole.cashier,
          status: StoreSubAccountStatus.active,
          isAssigned: false,
          canAccessHome: true,
          canUseHandover: true,
        },
      });
      expect(tx.storeSubAccount.updateMany).toHaveBeenCalledWith({
        where: {
          storeId: 1,
          slotIndex: { gt: 2 },
        },
        data: {
          status: StoreSubAccountStatus.disabled,
          employeeId: null,
          isAssigned: false,
          assignedAt: null,
          canAccessHome: false,
          canUseHandover: false,
        },
      });
      expect(tx.storeSubAccountQuotaAudit.create).toHaveBeenCalledWith({
        data: {
          storeId: 1,
          oldQuota: 5,
          newQuota: 2,
          operatorUserId: 99,
          reason: 'trim me',
        },
      });
      expect(
        storeSubAccountReadService.getStoreSubAccountSummary,
      ).toHaveBeenCalledWith(1);
    });
  });

  describe('updateSlot', () => {
    const storeId = 1;
    const summary = {
      quota: 2,
      usedCount: 1,
      availableCount: 1,
      roleSummary: [],
      slots: [],
    };

    beforeEach(() => {
      membershipAccessService.getSubAccountBenefitSnapshot.mockResolvedValue({
        level: 'yearly',
        eligible: true,
        quota: 2,
        quotaMax: 10,
        enabled: true,
        rawQuota: 2,
      });
      prismaService.storeSubAccount.upsert.mockResolvedValue(undefined);
      storeSubAccountReadService.getStoreSubAccountSummary.mockResolvedValue(
        summary,
      );
    });

    it('分配员工并设置登录信息时应创建或更新登录账号', async () => {
      prismaService.employee.findFirst.mockResolvedValue({ id: 100 });

      await expect(
        service.updateSlot(storeId, {
          slotIndex: 1,
          role: StoreSubAccountRole.cashier,
          employeeId: 100,
          initialPassword: 'test123456',
        }),
      ).resolves.toEqual(summary);
      expect(
        storeSubAccountLoginService.ensureEmployeeHasLoginAccount,
      ).toHaveBeenCalledWith(storeId, 100, {
        password: 'test123456',
        loginAccount: undefined,
      });
      expect(prismaService.storeSubAccount.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            storeId_slotIndex: {
              storeId,
              slotIndex: 1,
            },
          },
          create: expect.objectContaining({
            employeeId: 100,
            isAssigned: true,
            canAccessHome: true,
            canUseHandover: true,
          }),
          update: expect.objectContaining({
            employeeId: 100,
            isAssigned: true,
            canAccessHome: true,
            canUseHandover: true,
          }),
        }),
      );
    });

    it('未分配员工时不能配置登录信息', async () => {
      await expect(
        service.updateSlot(storeId, {
          slotIndex: 1,
          role: StoreSubAccountRole.cashier,
          loginAccount: 'cashier_01',
        }),
      ).rejects.toThrow(
        new BadRequestException('未分配员工时不能配置子账号登录信息'),
      );
    });

    it('目标员工不存在时应抛出异常', async () => {
      prismaService.employee.findFirst.mockResolvedValue(null);

      await expect(
        service.updateSlot(storeId, {
          slotIndex: 1,
          role: StoreSubAccountRole.cashier,
          employeeId: 100,
        }),
      ).rejects.toThrow(
        new NotFoundException('目标员工不存在或未处于在职状态'),
      );
    });

    it('未启用额度时不能配置槽位', async () => {
      membershipAccessService.getSubAccountBenefitSnapshot.mockResolvedValue({
        quota: 0,
        enabled: false,
      });

      await expect(
        service.updateSlot(storeId, {
          slotIndex: 1,
          role: StoreSubAccountRole.cashier,
        }),
      ).rejects.toThrow(
        new BadRequestException('当前门店未启用子账号额度，无法配置子账号槽位'),
      );
    });

    it('超出当前额度的槽位应直接拒绝', async () => {
      await expect(
        service.updateSlot(storeId, {
          slotIndex: 3,
          role: StoreSubAccountRole.cashier,
        }),
      ).rejects.toThrow(
        new BadRequestException('子账号槽位超出当前已配置额度'),
      );
    });
  });
});
