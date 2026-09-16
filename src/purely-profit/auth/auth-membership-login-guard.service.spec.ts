import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { StaffRole, StaffStatus, StoreSubAccountStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MembershipDowngradeService } from '../member/platform-membership/membership-downgrade.service';
import { AuthMembershipQueryService } from './auth-membership-query.service';
import {
  AuthMembershipLoginGuardService,
  SUB_ACCOUNT_SEAT_REVOKED_ERROR_CODE,
  SUB_ACCOUNT_SEAT_REVOKED_MESSAGE,
} from './auth-membership-login-guard.service';

type StaffRow = {
  role: StaffRole;
  employeeProfile: {
    subAccounts: {
      status: StoreSubAccountStatus;
      isAssigned: boolean;
      canAccessHome: boolean;
    } | null;
  } | null;
};

describe('AuthMembershipLoginGuardService', () => {
  let service: AuthMembershipLoginGuardService;
  let prismaService: {
    staff: { findMany: jest.Mock };
    store: { count: jest.Mock };
  };
  let membershipQueryService: { findMembershipRowsByUserId: jest.Mock };
  let membershipDowngradeService: { getDowngradeState: jest.Mock };

  const buildStaffRow = (
    overrides: {
      role?: StaffRole;
      seat?: Partial<{
        status: StoreSubAccountStatus;
        isAssigned: boolean;
        canAccessHome: boolean;
      }> | null;
      hasEmployeeProfile?: boolean;
    } = {},
  ): StaffRow => {
    const hasEmployeeProfile = overrides.hasEmployeeProfile ?? true;
    return {
      role: overrides.role ?? StaffRole.staff,
      employeeProfile: hasEmployeeProfile
        ? {
            subAccounts:
              overrides.seat === null
                ? null
                : {
                    status: StoreSubAccountStatus.disabled,
                    isAssigned: false,
                    canAccessHome: false,
                    ...overrides.seat,
                  },
          }
        : null,
    } as StaffRow;
  };

  beforeEach(async () => {
    prismaService = {
      staff: { findMany: jest.fn().mockResolvedValue([]) },
      store: { count: jest.fn().mockResolvedValue(0) },
    };
    membershipQueryService = {
      findMembershipRowsByUserId: jest.fn().mockResolvedValue([]),
    };
    membershipDowngradeService = {
      getDowngradeState: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthMembershipLoginGuardService,
        { provide: PrismaService, useValue: prismaService },
        {
          provide: AuthMembershipQueryService,
          useValue: membershipQueryService,
        },
        {
          provide: MembershipDowngradeService,
          useValue: membershipDowngradeService,
        },
      ],
    }).compile();

    service = module.get(AuthMembershipLoginGuardService);
  });

  describe('ensureStaffSubAccountSeatGranted', () => {
    it('员工账号的子账号席位已被关闭时拒绝登录', async () => {
      prismaService.staff.findMany.mockResolvedValue([
        buildStaffRow({ seat: { status: StoreSubAccountStatus.disabled } }),
      ]);

      await expect(service.ensureStaffSubAccountSeatGranted(7)).rejects.toThrow(
        new ForbiddenException({
          statusCode: 403,
          message: SUB_ACCOUNT_SEAT_REVOKED_MESSAGE,
          code: SUB_ACCOUNT_SEAT_REVOKED_ERROR_CODE,
        }),
      );
    });

    it('员工已分配槽位但槽位被停用时拒绝登录', async () => {
      prismaService.staff.findMany.mockResolvedValue([
        buildStaffRow({
          seat: {
            status: StoreSubAccountStatus.disabled,
            isAssigned: true,
          },
        }),
      ]);

      await expect(service.ensureStaffSubAccountSeatGranted(7)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('仍持有有效席位的多店员工放行', async () => {
      prismaService.staff.findMany.mockResolvedValue([
        buildStaffRow({ seat: { status: StoreSubAccountStatus.disabled } }),
        buildStaffRow({
          seat: {
            status: StoreSubAccountStatus.active,
            isAssigned: true,
            canAccessHome: true,
          },
        }),
      ]);

      await expect(
        service.ensureStaffSubAccountSeatGranted(7),
      ).resolves.toBeUndefined();
    });

    it('主账号身份（店主 / 店长）不受席位回收影响', async () => {
      prismaService.staff.findMany.mockResolvedValue([
        buildStaffRow({ role: StaffRole.owner, hasEmployeeProfile: false }),
        buildStaffRow({ seat: { status: StoreSubAccountStatus.disabled } }),
      ]);

      await expect(
        service.ensureStaffSubAccountSeatGranted(7),
      ).resolves.toBeUndefined();
    });

    it('没有 active Staff 行时直接放行，交由账号查找判定密码错误', async () => {
      prismaService.staff.findMany.mockResolvedValue([]);

      await expect(
        service.ensureStaffSubAccountSeatGranted(7),
      ).resolves.toBeUndefined();
    });

    it('查询时只取 active 的 Staff 行并排除已注销门店', async () => {
      prismaService.staff.findMany.mockResolvedValue([]);

      await service.ensureStaffSubAccountSeatGranted(7);

      expect(prismaService.staff.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 7,
            isActive: true,
            status: StaffStatus.active,
            store: { deletedAt: null },
          }),
        }),
      );
    });
  });

  describe('ensureSubAccountLoginAllowed（会员到期拦截）', () => {
    it('名下门店全部到期且本人不是店主时拒绝登录', async () => {
      membershipQueryService.findMembershipRowsByUserId.mockResolvedValue([
        { storeId: 11, subAccountId: 3 },
      ]);
      membershipDowngradeService.getDowngradeState.mockResolvedValue({
        isExpired: true,
      });
      prismaService.store.count.mockResolvedValue(0);

      await expect(service.ensureSubAccountLoginAllowed(7)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('还有未到期门店时放行', async () => {
      membershipQueryService.findMembershipRowsByUserId.mockResolvedValue([
        { storeId: 11, subAccountId: 3 },
        { storeId: 12, subAccountId: 4 },
      ]);
      membershipDowngradeService.getDowngradeState
        .mockResolvedValueOnce({ isExpired: true })
        .mockResolvedValueOnce({ isExpired: false });

      await expect(
        service.ensureSubAccountLoginAllowed(7),
      ).resolves.toBeUndefined();
    });

    it('纯主账号（无子账号上下文）不触发到期拦截', async () => {
      membershipQueryService.findMembershipRowsByUserId.mockResolvedValue([
        { storeId: 11, subAccountId: null },
      ]);

      await expect(
        service.ensureSubAccountLoginAllowed(7),
      ).resolves.toBeUndefined();
      expect(
        membershipDowngradeService.getDowngradeState,
      ).not.toHaveBeenCalled();
    });
  });
});
