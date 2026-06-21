import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { AccessControlService } from '../../access-control/access-control.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import { MembersAccessService } from './members-access.service';

describe('MembersAccessService', () => {
  let service: MembersAccessService;

  const prismaService = {
    $queryRaw: jest.fn(),
  };

  const accessControlService = {
    resolveCurrentStoreIdByPermission: jest.fn(),
    resolveCurrentStaffIdForStore: jest.fn(),
  };

  const user: AuthenticatedUser = {
    id: 1,
    email: 'boss@example.com',
    phone: '13800138000',
    name: '老板',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    lastActiveAt: null,
    currentMembership: null,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    accessControlService.resolveCurrentStoreIdByPermission.mockReturnValue(
      null,
    );
    accessControlService.resolveCurrentStaffIdForStore.mockReturnValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MembersAccessService,
        { provide: PrismaService, useValue: prismaService },
        { provide: AccessControlService, useValue: accessControlService },
      ],
    }).compile();

    service = module.get<MembersAccessService>(MembersAccessService);
  });

  it('getManageableStoreId 在当前 membership 有权限时直接返回门店 ID', async () => {
    const subAccountUser: AuthenticatedUser = {
      ...user,
      currentMembership: {
        staffId: 55,
        storeId: 48,
        role: StaffRole.STAFF,
        permissions: ['members:view', 'members:update'],
        isActive: true,
        subjectType: 'sub_account',
        linkedEmployeeId: 6,
        subAccountId: 3,
        subAccountRole: 'manager',
        subAccountStatus: 'active',
        subAccountAssigned: true,
        canAccessHome: true,
        canUseHandover: true,
      },
    };

    accessControlService.resolveCurrentStoreIdByPermission.mockReturnValue(48);

    await expect(
      service.getManageableStoreId(subAccountUser, 'members:view'),
    ).resolves.toBe(48);
  });

  it('getManageableStoreId 在当前 membership 无权限时返回 null', async () => {
    await expect(
      service.getManageableStoreId(user, 'members:view'),
    ).resolves.toBeNull();
  });

  it('resolveMembersViewStoreId 在无权限且未指定 storeId 时返回 null', async () => {
    await expect(
      service.resolveMembersViewStoreId(
        user,
        undefined,
        '无权查看该门店会员列表',
      ),
    ).resolves.toBeNull();
  });

  it('resolveMembersViewStoreId 在指定了其他门店时抛出异常', async () => {
    await expect(
      service.resolveMembersViewStoreId(user, 7, '无权查看该门店会员列表'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('ensureCanManageMembers 在门店不匹配时抛出异常', async () => {
    await expect(
      service.ensureCanManageMembers(user, 7, 'members:update'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('findManageableMemberOrThrow 返回会员并校验权限', async () => {
    prismaService.$queryRaw.mockResolvedValue([
      {
        id: 18,
        storeId: 6,
        name: '张三',
        phone: '13800138000',
        gender: 'MALE',
        level: 'silver',
        note: null,
        birthday: null,
        lastConsumeAt: null,
        points: 10,
        totalPointsEarned: 20,
        beanBalance: 3,
        isPartner: false,
        partnerLevel: null,
        totalRecharged: 0,
        rechargeCount: 0,
        invitedCount: 0,
        bannedReason: null,
        status: 'ACTIVE',
        createdAt: new Date('2026-05-12T00:00:00.000Z'),
        updatedAt: new Date('2026-05-13T00:00:00.000Z'),
      },
    ]);
    accessControlService.resolveCurrentStoreIdByPermission.mockReturnValue(6);

    await expect(
      service.findManageableMemberOrThrow(user, 18, 'members:view'),
    ).resolves.toMatchObject({
      id: 18,
      storeId: 6,
      name: '张三',
    });
  });

  it('findManageableMemberOrThrow 在会员不存在时抛出异常', async () => {
    prismaService.$queryRaw.mockResolvedValue([]);

    await expect(
      service.findManageableMemberOrThrow(user, 999, 'members:view'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('findOperatorStaffIdForStore 在当前 membership 命中时直接返回 staff id', async () => {
    accessControlService.resolveCurrentStaffIdForStore.mockReturnValue(55);

    await expect(service.findOperatorStaffIdForStore(user, 48)).resolves.toBe(
      55,
    );
  });

  it('findOperatorStaffIdForStore 在当前 membership 未命中时返回 null', async () => {
    await expect(
      service.findOperatorStaffIdForStore(user, 6),
    ).resolves.toBeNull();
  });
});
