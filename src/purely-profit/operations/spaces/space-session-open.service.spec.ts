import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisLockService } from '../../../redis/redis-lock.service';
import { ScanOrderingRealtimeService } from '../../../purely-club/scan-ordering/scan-ordering-realtime.service';
import { CommissionCoreService } from '../commission/commission-core.service';
import { SpaceReservationsStateService } from './space-reservations-state.service';
import { SpaceSessionOpenService } from './space-session-open.service';
import { aNonNegativeNumber } from '../../../spec-matchers';

describe('SpaceSessionOpenService', () => {
  let service: SpaceSessionOpenService;

  const transaction = {
    $queryRaw: jest.fn(),
    spaceReservation: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    spaceSession: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    space: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const prismaService = {
    space: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    spaceSession: {
      findFirst: jest.fn(),
    },
    staff: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const commerceAccessService = {
    ensureCanAccessStore: jest.fn(),
    findOperatorStaffIdForStore: jest.fn(),
  };

  const reservationsStateService = {
    repairInconsistentOccupiedSpace: jest.fn(),
    ensureReservationCanBeFulfilled: jest.fn(),
    resolveReservationBackStatus: jest.fn(),
  };

  const redisLockService = {
    acquireLock: jest.fn(),
    releaseLock: jest.fn(),
  };

  const realtimeService = {
    publishVoucherOrderStatusChanged: jest.fn(),
  };

  const commissionCoreService = {
    buildServicesMap: jest.fn(),
    resolveTechnicianNames: jest.fn(),
    normalizeAssignments: jest.fn(),
    recomputeAssignments: jest.fn(),
    createSettledRecords: jest.fn().mockResolvedValue(undefined),
    markSettledRecordsIncluded: jest.fn(),
    listConfigRecords: jest.fn(),
  };

  const user: AuthenticatedUser = {
    id: 1,
    email: 'boss@example.com',
    phone: '13800138000',
    name: '老板',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    lastActiveAt: null,
    currentMembership: {
      staffId: 8,
      storeId: 18,
      role: 'owner',
      permissions: ['*'],
      isActive: true,
      subjectType: 'owner',
      linkedEmployeeId: null,
      subAccountId: null,
      subAccountRole: null,
      subAccountStatus: null,
      subAccountAssigned: false,
      canAccessHome: true,
      canUseHandover: true,
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    commerceAccessService.ensureCanAccessStore.mockResolvedValue(undefined);
    commerceAccessService.findOperatorStaffIdForStore.mockResolvedValue(8);
    prismaService.staff.findUnique.mockResolvedValue({ name: '老板' });
    reservationsStateService.repairInconsistentOccupiedSpace.mockResolvedValue(
      undefined,
    );
    reservationsStateService.ensureReservationCanBeFulfilled.mockResolvedValue(
      undefined,
    );
    reservationsStateService.resolveReservationBackStatus.mockResolvedValue(
      'idle',
    );
    prismaService.$transaction.mockImplementation((callback) =>
      Promise.resolve(callback(transaction)),
    );

    // Mock RedisLockService: 默认成功获取分布式锁
    redisLockService.acquireLock.mockResolvedValue({
      resource: 'space:session:open:7',
      token: 'test-token',
      key: 'distributed-lock:space:session:open:7',
    });
    redisLockService.releaseLock.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpaceSessionOpenService,
        { provide: PrismaService, useValue: prismaService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        {
          provide: SpaceReservationsStateService,
          useValue: reservationsStateService,
        },
        {
          provide: RedisLockService,
          useValue: redisLockService,
        },
        {
          provide: ScanOrderingRealtimeService,
          useValue: realtimeService,
        },
        {
          provide: CommissionCoreService,
          useValue: commissionCoreService,
        },
      ],
    }).compile();

    service = module.get<SpaceSessionOpenService>(SpaceSessionOpenService);
  });

  it('无 active session 时允许直接开台（状态由运行态推导）', async () => {
    // Space.status 已移除，空间状态由运行态推导
    // 只要没有 active session 就允许开台，不再需要修复不一致状态
    const now = new Date('2026-06-07T10:00:00.000Z');
    // B1: openSession 改用 findFirst
    prismaService.space.findFirst.mockResolvedValue({
      id: 7,
      storeId: 18,
      capacity: 4,
      // status 字段已移除
      type: { name: '台球桌' },
    });
    prismaService.spaceSession.findFirst.mockResolvedValue(null);
    transaction.spaceSession.findFirst.mockResolvedValue(null);
    transaction.spaceSession.create.mockResolvedValue({
      id: 9,
      storeId: 18,
      spaceId: 7,
      reservationId: null,
      guestName: null,
      guestPhone: null,
      guestCount: null,
      startTime: now,
      endTime: null,
      billingMode: 'timed',
      hourlyRate: 6800, // DB 存储为分（68元）
      timeCost: null,
      countdownMinutes: null,
      autoCheckout: null,
      prepaidPaymentMethod: null,
      prepaidCustomerPaymentMethod: null,
      prepaidSettlementChannel: null,
      prepaidGrouponCode: null,
      prepaidGrouponPlatform: null,
      prepaidVoucherCode: null,
      prepaidVoucherPlatform: null,
      prepaidNote: null,
      prepaidAmount: null,
      prepaidVoucherFaceAmount: null,
      sessionItems: [],
      itemsCost: 0, // DB 存储为分（0元）
      sessionRenewRecords: [],
      status: 'active',
      saleOrderId: null,
      createdAt: now,
      updatedAt: now,
      space: {
        id: 7,
        name: 'A01',
        type: { name: '台球桌' },
      },
    });

    const result = await service.openSession(user, 7, {
      billingMode: 'timed',
      hourlyRate: 68,
    });

    // 验证成功创建会话，不再调用 resolveReservationBackStatus
    expect(result.id).toBe('9');
    expect(
      reservationsStateService.resolveReservationBackStatus,
    ).not.toHaveBeenCalled();
  });

  it('带 reservationId 开台时委托预约状态服务做履约校验', async () => {
    const now = new Date('2026-06-07T10:00:00.000Z');
    // B1: openSession 改用 findFirst
    prismaService.space.findFirst.mockResolvedValue({
      id: 7,
      storeId: 18,
      capacity: 4,
      status: 'idle',
      type: { name: '台球桌' },
    });
    transaction.space.findUnique.mockResolvedValue({
      id: 7,
      status: 'idle',
    });
    transaction.spaceSession.findFirst.mockResolvedValue(null);
    transaction.spaceReservation.findUnique.mockResolvedValue({
      id: 21,
      storeId: 18,
      spaceId: 7,
      status: 'pending',
    });
    transaction.spaceReservation.updateMany.mockResolvedValue({ count: 1 });
    transaction.spaceSession.create.mockResolvedValue({
      id: 10,
      storeId: 18,
      spaceId: 7,
      reservationId: 21,
      guestName: '张三',
      guestPhone: '13800138000',
      guestCount: 2,
      startTime: now,
      endTime: null,
      billingMode: 'timed',
      hourlyRate: 6800, // DB 存储为分（68元）
      timeCost: null,
      countdownMinutes: null,
      autoCheckout: null,
      prepaidPaymentMethod: null,
      prepaidCustomerPaymentMethod: null,
      prepaidSettlementChannel: null,
      prepaidGrouponCode: null,
      prepaidGrouponPlatform: null,
      prepaidVoucherCode: null,
      prepaidVoucherPlatform: null,
      prepaidNote: null,
      prepaidAmount: null,
      prepaidVoucherFaceAmount: null,
      sessionItems: [],
      itemsCost: 0, // DB 存储为分（0元）
      sessionRenewRecords: [],
      status: 'active',
      saleOrderId: null,
      createdAt: now,
      updatedAt: now,
      space: {
        id: 7,
        name: 'A01',
        type: { name: '台球桌' },
      },
    });
    transaction.space.update.mockResolvedValue(undefined);

    await service.openSession(user, 7, {
      billingMode: 'timed',
      hourlyRate: 68,
      reservationId: 21,
      guestName: '张三',
      guestPhone: '13800138000',
      guestCount: 2,
    });

    expect(
      reservationsStateService.ensureReservationCanBeFulfilled,
    ).toHaveBeenCalledWith(18, 7, 21);
    expect(transaction.spaceReservation.updateMany).toHaveBeenCalledWith({
      where: {
        id: 21,
        status: 'pending',
      },
      data: {
        status: 'fulfilled',
      },
    });
  });

  it('非自动结账倒计时开台也应保存预付款扩展字段', async () => {
    const now = new Date('2026-06-07T10:00:00.000Z');
    // B1: openSession 改用 findFirst
    prismaService.space.findFirst.mockResolvedValue({
      id: 7,
      storeId: 18,
      capacity: 4,
      status: 'idle',
      type: { name: '台球桌' },
    });
    transaction.space.findUnique.mockResolvedValue({
      id: 7,
      status: 'idle',
    });
    transaction.spaceSession.findFirst.mockResolvedValue(null);
    transaction.spaceSession.create.mockResolvedValue({
      id: 11,
      storeId: 18,
      spaceId: 7,
      reservationId: null,
      guestName: '张三',
      guestPhone: '13800138000',
      guestCount: 2,
      startTime: now,
      endTime: null,
      billingMode: 'countdown',
      hourlyRate: 6800, // DB 存储为分（68元）
      timeCost: null,
      countdownMinutes: 60,
      autoCheckout: false,
      prepaidPaymentMethod: 'cash',
      prepaidCustomerPaymentMethod: 'groupon_voucher',
      prepaidSettlementChannel: 'meituan_groupon',
      prepaidGrouponCode: 'MT100',
      prepaidGrouponPlatform: '美团',
      prepaidVoucherCode: 'MT100',
      prepaidVoucherPlatform: '美团',
      prepaidNote: '提前到店',
      prepaidAmount: 16800, // DB 存储为分（168元）
      prepaidVoucherFaceAmount: 16800, // DB 存储为分（168元）
      sessionItems: [],
      itemsCost: 0, // DB 存储为分（0元）
      sessionRenewRecords: [],
      status: 'active',
      saleOrderId: null,
      createdAt: now,
      updatedAt: now,
      space: {
        id: 7,
        name: 'A01',
        type: { name: '台球桌' },
      },
    });
    transaction.space.update.mockResolvedValue(undefined);

    await service.openSession(user, 7, {
      billingMode: 'countdown',
      hourlyRate: 68,
      countdownMinutes: 60,
      autoCheckout: false,
      guestName: '张三',
      guestPhone: '13800138000',
      guestCount: 2,
      prepaidPaymentMethod: 'cash',
      prepaidCustomerPaymentMethod: 'groupon_voucher',
      prepaidSettlementChannel: 'meituan_groupon',
      prepaidGrouponCode: 'MT100',
      prepaidGrouponPlatform: '美团',
      prepaidVoucherCode: 'MT100',
      prepaidVoucherPlatform: '美团',
      prepaidNote: '提前到店',
      prepaidAmount: 168,
      prepaidVoucherFaceAmount: 168,
    });

    expect(transaction.spaceSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          autoCheckout: false,
          prepaidPaymentMethod: 'cash',
          prepaidCustomerPaymentMethod: 'groupon_voucher',
          prepaidSettlementChannel: 'meituan_groupon',
          prepaidGrouponCode: 'MT100',
          prepaidGrouponPlatform: '美团',
          prepaidVoucherCode: 'MT100',
          prepaidVoucherPlatform: '美团',
          prepaidNote: '提前到店',
          prepaidAmount: 16800, // Money.fromInputYuan(168).toDbCents() = 16800分
          prepaidVoucherFaceAmount: 16800, // Money.fromInputYuan(168).toDbCents() = 16800分
        }),
      }),
    );
  });

  it('开台时若锁内发现目标空间已被占用应阻止继续开台', async () => {
    // B1: openSession 改用 findFirst
    prismaService.space.findFirst.mockResolvedValue({
      id: 7,
      storeId: 18,
      capacity: 4,
      status: 'idle',
      type: { name: '台球桌' },
    });
    transaction.space.findUnique.mockResolvedValue({
      id: 7,
      status: 'occupied',
    });
    transaction.spaceSession.findFirst.mockResolvedValue({ id: 99 });

    await expect(
      service.openSession(user, 7, {
        billingMode: 'timed',
        hourlyRate: 68,
      }),
    ).rejects.toThrow('空间当前使用中，无法重复开台');

    // 分布式锁应被获取并在抛出异常后正确释放
    expect(redisLockService.acquireLock).toHaveBeenCalledTimes(1);
    expect(redisLockService.acquireLock).toHaveBeenCalledWith(
      'space:session:open:7',
      expect.objectContaining({ ttlSeconds: aNonNegativeNumber }),
    );
    expect(redisLockService.releaseLock).toHaveBeenCalledTimes(1);
    expect(transaction.spaceSession.create).not.toHaveBeenCalled();
  });

  it('履约开台时若锁内发现预约已处理应阻止继续开台', async () => {
    // B1: openSession 改用 findFirst
    prismaService.space.findFirst.mockResolvedValue({
      id: 7,
      storeId: 18,
      capacity: 4,
      status: 'idle',
      type: { name: '台球桌' },
    });
    transaction.space.findUnique.mockResolvedValue({
      id: 7,
      status: 'reserved',
    });
    transaction.spaceSession.findFirst.mockResolvedValue(null);
    transaction.spaceReservation.findFirst.mockResolvedValue({ id: 21 });
    transaction.spaceReservation.findUnique.mockResolvedValue({
      id: 21,
      storeId: 18,
      spaceId: 7,
      status: 'fulfilled',
    });

    await expect(
      service.openSession(user, 7, {
        billingMode: 'timed',
        hourlyRate: 68,
        reservationId: 21,
      }),
    ).rejects.toThrow('当前预约已处理，无法再次履约开台');

    expect(transaction.spaceReservation.updateMany).not.toHaveBeenCalled();
    expect(transaction.spaceSession.create).not.toHaveBeenCalled();
  });
});
