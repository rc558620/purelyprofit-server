import { ConflictException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StaffRole, StaffStatus } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { AccessControlService } from '../../access-control/access-control.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';
import { StaffAccessService } from './staff-access.service';
import { StaffProfileService } from './staff-profile.service';
import { StaffService } from './staff.service';

describe('StaffService', () => {
  let service: StaffService;

  const prismaService = {
    staff: {
      findFirst: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    store: {
      findFirst: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
  };

  const accessControlService = {
    getEffectivePermissions: jest.fn(),
    hasPermission: jest.fn(),
    resolveCurrentStoreIdByPermission: jest.fn(),
  };

  const subscriptionsService = {
    getSeatSummary: jest.fn(),
  };

  const configService = {
    get: jest.fn(),
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

  /** 邮箱与 user 一致，用于测试 activate 的邮箱归属校验 */
  const staffUser: AuthenticatedUser = {
    id: 5,
    email: 'staff@example.com',
    phone: '13800138001',
    name: '员工',
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

    configService.get.mockImplementation((key: string) => {
      const configMap: Record<string, number> = {
        'app.defaultPageSize': 10,
        'app.maxPageSize': 50,
      };
      return configMap[key];
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StaffService,
        StaffProfileService,
        StaffAccessService,
        { provide: PrismaService, useValue: prismaService },
        { provide: AccessControlService, useValue: accessControlService },
        { provide: SubscriptionsService, useValue: subscriptionsService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<StaffService>(StaffService);
  });

  /* ==================== invite ==================== */

  it('invite 在账号已绑定其他门店员工时阻止继续邀请', async () => {
    prismaService.staff.findFirst.mockResolvedValueOnce({ id: 18, storeId: 9 });
    accessControlService.getEffectivePermissions.mockReturnValue(['*']);
    accessControlService.hasPermission.mockReturnValue(true);
    accessControlService.resolveCurrentStoreIdByPermission.mockReturnValue(8);

    await expect(
      service.invite(user, {
        storeId: 8,
        name: '李四',
        email: 'staff@example.com',
        phone: '13800138001',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prismaService.staff.findFirst).toHaveBeenCalledWith({
      where: {
        storeId: { not: 8 },
        isActive: true,
        OR: [{ email: 'staff@example.com' }],
      },
      select: { id: true, storeId: true },
    });
    expect(prismaService.staff.create).not.toHaveBeenCalled();
  });

  it('invite 在单门店约束未触发时正常创建邀请记录', async () => {
    prismaService.staff.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    prismaService.user.findUnique.mockResolvedValue({ id: 12 });
    prismaService.staff.create.mockResolvedValue({
      id: 20,
      storeId: 8,
      userId: 12,
      email: 'staff@example.com',
      name: '李四',
      phone: '13800138001',
      role: StaffRole.staff,
      permissions: [],
      status: StaffStatus.invited,
      isSeatActive: false,
      isActive: true,
      createdAt: new Date('2026-05-13T10:00:00.000Z'),
      updatedAt: new Date('2026-05-13T10:00:00.000Z'),
      lastActiveAt: null,
    });
    subscriptionsService.getSeatSummary.mockResolvedValue({
      maxAccountSeats: 5,
      activeSeatCount: 1,
      availableSeatCount: 4,
    });
    accessControlService.getEffectivePermissions.mockReturnValue(['*']);
    accessControlService.hasPermission.mockReturnValue(true);
    accessControlService.resolveCurrentStoreIdByPermission.mockReturnValue(8);

    const result = await service.invite(user, {
      storeId: 8,
      name: '李四',
      email: 'STAFF@example.com',
      phone: '13800138001',
    });

    expect(prismaService.staff.create).toHaveBeenCalledWith({
      data: {
        storeId: 8,
        userId: 12,
        email: 'staff@example.com',
        name: '李四',
        phone: '13800138001',
        role: StaffRole.staff,
        permissions: [],
        status: StaffStatus.invited,
        isSeatActive: false,
        isActive: true,
      },
    });
    expect(result.message).toBe('员工已创建，待老板激活后占用账号席位');
  });

  /* ---- BUG-8：已禁用员工允许重新邀请 ---- */
  it('invite 在员工已不活跃时允许重新邀请并更新信息', async () => {
    prismaService.staff.findFirst
      .mockResolvedValueOnce(null) // ensureAccountCanOnlyBindSingleStore 查询
      .mockResolvedValueOnce({
        // invite 内部按 storeId+email 查询
        id: 20,
        storeId: 8,
        email: 'staff@example.com',
        name: '旧名',
        status: StaffStatus.disabled,
        isSeatActive: false,
        isActive: false, // 非活跃状态
      });
    prismaService.user.findUnique.mockResolvedValue({ id: 12 });
    prismaService.staff.update.mockResolvedValue({
      id: 20,
      storeId: 8,
      userId: 12,
      email: 'staff@example.com',
      name: '新名',
      phone: '13800138002',
      role: StaffRole.manager,
      permissions: [],
      status: StaffStatus.invited,
      isSeatActive: false,
      isActive: true,
    });
    subscriptionsService.getSeatSummary.mockResolvedValue({
      maxAccountSeats: 5,
      activeSeatCount: 1,
      availableSeatCount: 4,
    });
    accessControlService.resolveCurrentStoreIdByPermission.mockReturnValue(8);

    const result = await service.invite(user, {
      storeId: 8,
      name: '新名',
      email: 'staff@example.com',
      phone: '13800138002',
      role: StaffRole.manager,
    });

    expect(prismaService.staff.update).toHaveBeenCalledWith({
      where: { id: 20 },
      data: expect.objectContaining({
        name: '新名',
        phone: '13800138002',
        role: StaffRole.manager,
        status: StaffStatus.invited,
        isSeatActive: false,
        isActive: true,
      }),
    });
    expect(result.message).toContain('重新邀请');
  });

  it('invite 在活跃员工重复邀请时阻止', async () => {
    prismaService.staff.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 20,
        storeId: 8,
        email: 'staff@example.com',
        isActive: true, // 活跃状态
      });
    prismaService.user.findUnique.mockResolvedValue({ id: 12 });
    accessControlService.resolveCurrentStoreIdByPermission.mockReturnValue(8);

    await expect(
      service.invite(user, {
        storeId: 8,
        name: '李四',
        email: 'staff@example.com',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  /* ==================== activate ==================== */

  it('activate 在当前账号已拥有其他门店时阻止激活席位', async () => {
    prismaService.store.findFirst.mockResolvedValue({ id: 99 });
    prismaService.staff.findFirst.mockResolvedValue(null);

    await expect(
      service.activate(user, {
        storeId: 8,
        email: 'staff@example.com',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prismaService.store.findFirst).toHaveBeenCalledWith({
      where: {
        ownerId: user.id,
        deletedAt: null,
        id: { not: 8 },
      },
      select: { id: true },
    });
    expect(prismaService.staff.update).not.toHaveBeenCalled();
  });

  /* ---- BUG-9：activate 校验激活人邮箱归属 ---- */
  it('activate 在登录邮箱与被邀请邮箱不一致时拒绝激活', async () => {
    // user 的邮箱是 boss@example.com，但邀请邮箱是 staff@example.com
    prismaService.store.findFirst.mockResolvedValue(null);
    prismaService.staff.findFirst.mockResolvedValue(null); // ensureAccountCanOnlyBindSingleStore
    prismaService.staff.findFirst // activate 内部查询
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 20,
        storeId: 8,
        email: 'staff@example.com',
        userId: null,
        status: StaffStatus.invited,
        isSeatActive: false,
      });

    // boss 用户尝试激活发给 staff 的邀请
    await expect(
      service.activate(user, {
        storeId: 8,
        email: 'staff@example.com',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('activate 在邮箱匹配时允许正常激活', async () => {
    prismaService.store.findFirst.mockResolvedValue(null);
    prismaService.staff.findFirst
      .mockResolvedValueOnce(null) // ensureAccountCanOnlyBindSingleStore
      .mockResolvedValueOnce({
        // activate 内部查询
        id: 20,
        storeId: 8,
        email: 'staff@example.com',
        userId: 5,
        status: StaffStatus.invited,
        isSeatActive: false,
      });
    subscriptionsService.getSeatSummary.mockResolvedValue({
      maxAccountSeats: 5,
      activeSeatCount: 1,
      availableSeatCount: 4,
    });
    prismaService.staff.update.mockResolvedValue({
      id: 20,
      storeId: 8,
      userId: 5,
      email: 'staff@example.com',
      name: '员工',
      role: StaffRole.staff,
      permissions: [],
      status: StaffStatus.active,
      isSeatActive: true,
      isActive: true,
    });

    const result = await service.activate(staffUser, {
      storeId: 8,
      email: 'staff@example.com',
    });

    expect(result.message).toBe('员工账号已激活，可登录系统');
  });

  /* ==================== list ==================== */

  it('list 在请求其他门店数据时返回空列表', async () => {
    prismaService.staff.findFirst.mockResolvedValue({
      id: 5,
      storeId: 8,
      role: StaffRole.owner,
      permissions: ['*'],
      isActive: true,
    });
    accessControlService.getEffectivePermissions.mockReturnValue(['*']);
    accessControlService.hasPermission.mockReturnValue(true);
    accessControlService.resolveCurrentStoreIdByPermission.mockReturnValue(8);

    const result = await service.list(user, {
      storeId: 9,
      page: 2,
      pageSize: 5,
    });

    expect(result).toEqual({
      items: [],
      meta: {
        page: 2,
        pageSize: 5,
        total: 0,
        totalPages: 1,
      },
    });
    expect(prismaService.staff.findMany).not.toHaveBeenCalled();
    expect(prismaService.staff.count).not.toHaveBeenCalled();
  });

  it('list 在无任何门店权限时返回空列表', async () => {
    prismaService.staff.findFirst.mockResolvedValue(null);

    const result = await service.list(user, {
      page: 1,
      pageSize: 10,
    });

    expect(result).toEqual({
      items: [],
      meta: {
        page: 1,
        pageSize: 10,
        total: 0,
        totalPages: 1,
      },
    });
  });

  /* ==================== update ==================== */

  /* ---- BUG-1：update 启用员工时检查席位余量 ---- */
  it('update 在启用未占席位的员工时检查席位余量', async () => {
    prismaService.staff.findFirst.mockResolvedValue({
      id: 20,
      storeId: 8,
      role: StaffRole.staff,
      isSeatActive: false, // 当前未占席位
    });
    accessControlService.resolveCurrentStoreIdByPermission.mockReturnValue(8);
    subscriptionsService.getSeatSummary.mockResolvedValue({
      maxAccountSeats: 5,
      activeSeatCount: 5,
      availableSeatCount: 0, // 无可用席位
    });

    await expect(
      service.update(user, 20, { isActive: true }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('update 在席位充足时允许启用员工', async () => {
    prismaService.staff.findFirst.mockResolvedValue({
      id: 20,
      storeId: 8,
      role: StaffRole.staff,
      isSeatActive: false,
    });
    accessControlService.resolveCurrentStoreIdByPermission.mockReturnValue(8);
    subscriptionsService.getSeatSummary.mockResolvedValue({
      maxAccountSeats: 5,
      activeSeatCount: 3,
      availableSeatCount: 2,
    });
    prismaService.staff.update.mockResolvedValue({
      id: 20,
      storeId: 8,
      email: 'staff@example.com',
      name: '员工',
      role: StaffRole.staff,
      permissions: [],
      status: StaffStatus.invited,
      isSeatActive: false,
      isActive: true,
    });

    const result = await service.update(user, 20, { isActive: true });
    expect(result.isActive).toBe(true);
    // 启用时不自动占用席位（BUG-3 修复）
    expect(prismaService.staff.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isActive: true,
          isSeatActive: undefined, // 不自动占用
          status: undefined, // 不自动设 ACTIVE
        }),
      }),
    );
  });

  /* ---- BUG-3：update 禁用员工时释放席位但不自动占用 ---- */
  it('update 在禁用员工时释放席位并设状态为 DISABLED', async () => {
    prismaService.staff.findFirst.mockResolvedValue({
      id: 20,
      storeId: 8,
      role: StaffRole.staff,
      isSeatActive: true,
    });
    accessControlService.resolveCurrentStoreIdByPermission.mockReturnValue(8);
    prismaService.staff.update.mockResolvedValue({
      id: 20,
      storeId: 8,
      email: 'staff@example.com',
      name: '员工',
      role: StaffRole.staff,
      permissions: [],
      status: StaffStatus.disabled,
      isSeatActive: false,
      isActive: false,
    });

    await service.update(user, 20, { isActive: false });

    expect(prismaService.staff.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isActive: false,
          isSeatActive: false,
          status: StaffStatus.disabled,
        }),
      }),
    );
  });

  /* ==================== remove ==================== */

  /* ---- BUG-10：remove 改为软删除 ---- */
  it('remove 执行软删除而非硬删除', async () => {
    prismaService.staff.findFirst.mockResolvedValue({
      id: 20,
      storeId: 8,
      role: StaffRole.staff,
      isSeatActive: true,
    });
    accessControlService.resolveCurrentStoreIdByPermission.mockReturnValue(8);
    prismaService.staff.update.mockResolvedValue({
      id: 20,
      storeId: 8,
      email: 'staff@example.com',
      name: '员工',
      role: StaffRole.staff,
      permissions: [],
      status: StaffStatus.disabled,
      isSeatActive: false,
      isActive: false,
    });

    await service.remove(user, 20);

    // 应该调用 update 而非 delete
    expect(prismaService.staff.update).toHaveBeenCalledWith({
      where: { id: 20 },
      data: {
        isActive: false,
        isSeatActive: false,
        status: StaffStatus.disabled,
      },
    });
    expect(prismaService.staff.delete).not.toHaveBeenCalled();
  });
});
