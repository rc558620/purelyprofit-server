import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { StaffRole, StaffStatus } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { AccessControlService } from '../../access-control/access-control.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import { MembersAccessService } from './members-access.service';

describe('MembersAccessService', () => {
  let service: MembersAccessService;

  const prismaService = {
    staff: {
      findFirst: jest.fn(),
    },
    $queryRaw: jest.fn(),
  };

  const accessControlService = {
    getEffectivePermissions: jest.fn(),
    hasPermission: jest.fn(),
  };

  const user: AuthenticatedUser = {
    id: 1,
    email: 'boss@example.com',
    phone: '13800138000',
    name: '老板',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    currentMembership: null,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MembersAccessService,
        { provide: PrismaService, useValue: prismaService },
        { provide: AccessControlService, useValue: accessControlService },
      ],
    }).compile();

    service = module.get<MembersAccessService>(MembersAccessService);
  });

  it('getManageableStoreId 在有权限时返回门店 ID', async () => {
    prismaService.staff.findFirst.mockResolvedValue({
      storeId: 6,
      role: StaffRole.OWNER,
      permissions: [],
    });
    accessControlService.getEffectivePermissions.mockReturnValue(['*']);
    accessControlService.hasPermission.mockReturnValue(true);

    await expect(
      service.getManageableStoreId(user, 'members:view'),
    ).resolves.toBe(6);
  });

  it('resolveMembersViewStoreId 在无权限且未指定 storeId 时返回 null', async () => {
    prismaService.staff.findFirst.mockResolvedValue(null);

    await expect(
      service.resolveMembersViewStoreId(
        user,
        undefined,
        '无权查看该门店会员列表',
      ),
    ).resolves.toBeNull();
  });

  it('resolveMembersViewStoreId 在指定了其他门店时抛出异常', async () => {
    prismaService.staff.findFirst.mockResolvedValue({
      storeId: 6,
      role: StaffRole.MANAGER,
      permissions: ['members:view'],
    });
    accessControlService.getEffectivePermissions.mockReturnValue([
      'members:view',
    ]);
    accessControlService.hasPermission.mockReturnValue(true);

    await expect(
      service.resolveMembersViewStoreId(user, 7, '无权查看该门店会员列表'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('ensureCanManageMembers 在门店不匹配时抛出异常', async () => {
    prismaService.staff.findFirst.mockResolvedValue({
      storeId: 6,
      role: StaffRole.MANAGER,
      permissions: ['members:update'],
    });
    accessControlService.getEffectivePermissions.mockReturnValue([
      'members:update',
    ]);
    accessControlService.hasPermission.mockReturnValue(true);

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
    prismaService.staff.findFirst.mockResolvedValue({
      storeId: 6,
      role: StaffRole.OWNER,
      permissions: [],
    });
    accessControlService.getEffectivePermissions.mockReturnValue(['*']);
    accessControlService.hasPermission.mockReturnValue(true);

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

  it('findOperatorStaffIdForStore 返回当前门店 staff id', async () => {
    prismaService.staff.findFirst.mockResolvedValue({ id: 88 });

    await expect(service.findOperatorStaffIdForStore(user, 6)).resolves.toBe(
      88,
    );
    expect(prismaService.staff.findFirst).toHaveBeenCalledWith({
      where: {
        storeId: 6,
        OR: [{ userId: user.id }, { email: user.email }, { phone: user.phone }],
        isActive: true,
        status: StaffStatus.ACTIVE,
      },
      select: {
        id: true,
      },
      orderBy: {
        id: 'asc',
      },
    });
  });
});
