import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  EmployeeStatus,
  StaffStatus,
  StoreSubAccountRole,
  StoreSubAccountStatus,
} from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { PlatformMembershipAccessService } from './platform-membership-access.service';
import { StoreSubAccountService } from './store-sub-account.service';

describe('StoreSubAccountService', () => {
  let service: StoreSubAccountService;
  let prismaService: {
    employee: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    staff: {
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    user: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    storeSubAccount: {
      findMany: jest.Mock;
      upsert: jest.Mock;
    };
    storeMembershipProfile: {
      findUnique: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let membershipAccessService: {
    getSubAccountBenefitSnapshot: jest.Mock;
    ensureSubAccountConfigurable: jest.Mock;
  };

  beforeEach(async () => {
    const mockPrismaService = {
      employee: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      staff: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      storeSubAccount: {
        findMany: jest.fn(),
        upsert: jest.fn(),
      },
      storeMembershipProfile: {
        findUnique: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    const mockMembershipAccessService = {
      getSubAccountBenefitSnapshot: jest.fn(),
      ensureSubAccountConfigurable: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StoreSubAccountService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: PlatformMembershipAccessService,
          useValue: mockMembershipAccessService,
        },
      ],
    }).compile();

    service = module.get<StoreSubAccountService>(StoreSubAccountService);
    prismaService = module.get(PrismaService);
    membershipAccessService = module.get(PlatformMembershipAccessService);
  });

  describe('updateSlot - 子账号密码设置与账户创建', () => {
    const storeId = 1;
    const input = {
      slotIndex: 1,
      role: StoreSubAccountRole.cashier,
      employeeId: 100,
      initialPassword: 'test123456',
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
      membershipAccessService.ensureSubAccountConfigurable.mockResolvedValue(
        undefined,
      );
      prismaService.storeSubAccount.findMany.mockResolvedValue([]);
      prismaService.storeSubAccount.upsert.mockResolvedValue({});
    });

    it('员工无关联Staff且无User时，应创建User和Staff并关联', async () => {
      // 模拟员工存在，但没有关联 Staff
      prismaService.employee.findFirst.mockResolvedValue({
        id: 100,
        phone: '13800138001',
        name: '测试员工',
        linkedStaffId: null,
      });
      prismaService.employee.findUnique.mockResolvedValue({
        id: 100,
        phone: '13800138001',
        name: '测试员工',
        linkedStaffId: null,
        linkedStaff: null,
      });
      // 模拟不存在该手机号的 Staff
      prismaService.staff.findFirst
        .mockResolvedValueOnce(null) // 查找 userId 不为 null 的 Staff
        .mockResolvedValueOnce(null); // 查找同手机号的 Staff
      // 模拟不存在该别名邮箱的 User
      prismaService.user.findUnique.mockResolvedValue(null);
      // 模拟创建 User
      prismaService.user.create.mockResolvedValue({ id: 1001 });
      // 模拟创建 Staff
      prismaService.staff.create.mockResolvedValue({ id: 2001 });
      prismaService.employee.update.mockResolvedValue({});

      await service.updateSlot(storeId, input);

      // 验证创建了 User
      expect(prismaService.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: 'phone_13800138001@purelyprofit.local',
          name: '测试员工',
        }),
        select: { id: true },
      });
      // 验证创建了 Staff
      expect(prismaService.staff.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          storeId,
          userId: 1001,
          phone: '13800138001',
          name: '测试员工',
        }),
      });
      // 验证关联了 Employee 到 Staff
      expect(prismaService.employee.update).toHaveBeenCalledWith({
        where: { id: 100 },
        data: { linkedStaffId: 2001 },
      });
    });

    it('员工已有关联Staff和User时，应更新密码', async () => {
      prismaService.employee.findFirst.mockResolvedValue({
        id: 100,
        phone: '13800138001',
        name: '测试员工',
        linkedStaffId: 2001,
      });
      prismaService.employee.findUnique.mockResolvedValue({
        id: 100,
        phone: '13800138001',
        name: '测试员工',
        linkedStaffId: 2001,
        linkedStaff: {
          id: 2001,
          userId: 1001,
          user: { id: 1001 },
        },
      });
      prismaService.user.update.mockResolvedValue({});

      await service.updateSlot(storeId, input);

      // 验证更新了密码
      expect(prismaService.user.update).toHaveBeenCalledWith({
        where: { id: 1001 },
        data: { password: expect.any(String) },
      });
    });

    it('员工有关联Staff但无User时，应创建User并关联到Staff', async () => {
      prismaService.employee.findFirst.mockResolvedValue({
        id: 100,
        phone: '13800138001',
        name: '测试员工',
        linkedStaffId: 2001,
      });
      prismaService.employee.findUnique.mockResolvedValue({
        id: 100,
        phone: '13800138001',
        name: '测试员工',
        linkedStaffId: 2001,
        linkedStaff: {
          id: 2001,
          userId: null,
          user: null,
        },
      });
      prismaService.staff.findFirst.mockResolvedValue(null);
      prismaService.user.findUnique.mockResolvedValue(null);
      prismaService.user.create.mockResolvedValue({ id: 1001 });
      prismaService.staff.update.mockResolvedValue({});

      await service.updateSlot(storeId, input);

      // 验证创建了 User
      expect(prismaService.user.create).toHaveBeenCalled();
      // 验证关联了 User 到 Staff
      expect(prismaService.staff.update).toHaveBeenCalledWith({
        where: { id: 2001 },
        data: { userId: 1001 },
      });
    });

    it('员工手机号为空时，应抛出异常', async () => {
      prismaService.employee.findFirst.mockResolvedValue({
        id: 100,
        phone: null,
        name: '测试员工',
        linkedStaffId: null,
      });
      prismaService.employee.findUnique.mockResolvedValue({
        id: 100,
        phone: null,
        name: '测试员工',
        linkedStaffId: null,
        linkedStaff: null,
      });

      await expect(service.updateSlot(storeId, input)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.updateSlot(storeId, input)).rejects.toThrow(
        '员工手机号为空，无法创建登录账号',
      );
    });

    it('员工不存在时，应抛出异常', async () => {
      prismaService.employee.findFirst.mockResolvedValue(null);

      await expect(service.updateSlot(storeId, input)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.updateSlot(storeId, input)).rejects.toThrow(
        '目标员工不存在或未处于在职状态',
      );
    });

    it('已存在相同手机号的Staff时，应复用Staff并关联Employee', async () => {
      prismaService.employee.findFirst.mockResolvedValue({
        id: 100,
        phone: '13800138001',
        name: '测试员工',
        linkedStaffId: null,
      });
      prismaService.employee.findUnique.mockResolvedValue({
        id: 100,
        phone: '13800138001',
        name: '测试员工',
        linkedStaffId: null,
        linkedStaff: null,
      });
      prismaService.staff.findFirst
        .mockResolvedValueOnce(null) // 查找 userId 不为 null 的 Staff
        .mockResolvedValueOnce({
          id: 2001,
          userId: null,
        }); // 查找同手机号的 Staff
      prismaService.user.findUnique.mockResolvedValue(null);
      prismaService.user.create.mockResolvedValue({ id: 1001 });
      prismaService.staff.update.mockResolvedValue({});
      prismaService.employee.update.mockResolvedValue({});

      await service.updateSlot(storeId, input);

      // 验证关联了 User 到已存在的 Staff 并设置默认 email
      expect(prismaService.staff.update).toHaveBeenCalledWith({
        where: { id: 2001 },
        data: {
          userId: 1001,
          email: 'phone_13800138001@purelyprofit.local',
        },
      });
      // 验证关联了 Employee 到已存在的 Staff
      expect(prismaService.employee.update).toHaveBeenCalledWith({
        where: { id: 100 },
        data: { linkedStaffId: 2001 },
      });
    });
  });
});
