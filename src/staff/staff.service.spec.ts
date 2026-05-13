import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StaffRole, StaffStatus } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { AccessControlService } from '../access-control/access-control.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
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
    currentMembership: null,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

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
        { provide: PrismaService, useValue: prismaService },
        { provide: AccessControlService, useValue: accessControlService },
        { provide: SubscriptionsService, useValue: subscriptionsService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<StaffService>(StaffService);
  });

  it('invite 在账号已绑定其他门店员工时阻止继续邀请', async () => {
    prismaService.staff.findFirst
      .mockResolvedValueOnce({
        id: 5,
        storeId: 8,
        role: StaffRole.OWNER,
        permissions: ['*'],
        isActive: true,
      })
      .mockResolvedValueOnce({ id: 18, storeId: 9 });
    accessControlService.getEffectivePermissions.mockReturnValue(['*']);
    accessControlService.hasPermission.mockReturnValue(true);

    await expect(
      service.invite(user, {
        storeId: 8,
        name: '李四',
        email: 'staff@example.com',
        phone: '13800138001',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prismaService.staff.findFirst).toHaveBeenNthCalledWith(2, {
      where: {
        storeId: { not: 8 },
        isActive: true,
        OR: [{ email: 'staff@example.com' }],
      },
      select: { id: true, storeId: true },
    });
    expect(prismaService.staff.create).not.toHaveBeenCalled();
  });

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
        id: { not: 8 },
      },
      select: { id: true },
    });
    expect(prismaService.staff.update).not.toHaveBeenCalled();
  });

  it('list 在请求其他门店数据时返回空列表', async () => {
    prismaService.staff.findFirst.mockResolvedValue({
      id: 5,
      storeId: 8,
      role: StaffRole.OWNER,
      permissions: ['*'],
      isActive: true,
    });
    accessControlService.getEffectivePermissions.mockReturnValue(['*']);
    accessControlService.hasPermission.mockReturnValue(true);

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

  it('invite 在单门店约束未触发时正常创建邀请记录', async () => {
    prismaService.staff.findFirst
      .mockResolvedValueOnce({
        id: 5,
        storeId: 8,
        role: StaffRole.OWNER,
        permissions: ['*'],
        isActive: true,
      })
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
      role: StaffRole.STAFF,
      permissions: [],
      status: StaffStatus.INVITED,
      isSeatActive: false,
      isActive: true,
      createdAt: new Date('2026-05-13T10:00:00.000Z'),
      updatedAt: new Date('2026-05-13T10:00:00.000Z'),
    });
    subscriptionsService.getSeatSummary.mockResolvedValue({
      totalSeatCount: 5,
      usedSeatCount: 1,
      availableSeatCount: 4,
      occupiedSeatCount: 1,
      pendingSeatCount: 0,
    });
    accessControlService.getEffectivePermissions.mockReturnValue(['*']);
    accessControlService.hasPermission.mockReturnValue(true);

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
        role: StaffRole.STAFF,
        permissions: [],
        status: StaffStatus.INVITED,
        isSeatActive: false,
        isActive: true,
      },
    });
    expect(result.message).toBe('员工已创建，待老板激活后占用账号席位');
  });
});
