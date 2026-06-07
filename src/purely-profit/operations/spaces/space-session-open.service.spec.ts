import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { SpaceReservationsStateService } from './space-reservations-state.service';
import { SpaceSessionOpenService } from './space-session-open.service';

describe('SpaceSessionOpenService', () => {
  let service: SpaceSessionOpenService;

  const transaction = {
    spaceReservation: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    spaceSession: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    space: {
      update: jest.fn(),
    },
  };

  const prismaService = {
    space: {
      findUnique: jest.fn(),
    },
    spaceSession: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const commerceAccessService = {
    ensureCanAccessStore: jest.fn(),
  };

  const reservationsStateService = {
    repairInconsistentOccupiedSpace: jest.fn(),
    ensureReservationCanBeFulfilled: jest.fn(),
  };

  const user: AuthenticatedUser = {
    id: 1,
    email: 'boss@example.com',
    phone: '13800138000',
    name: '老板',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    currentMembership: {
      staffId: 8,
      storeId: 18,
      role: 'OWNER',
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
    reservationsStateService.repairInconsistentOccupiedSpace.mockResolvedValue(
      undefined,
    );
    reservationsStateService.ensureReservationCanBeFulfilled.mockResolvedValue(
      undefined,
    );
    prismaService.$transaction.mockImplementation((callback) =>
      Promise.resolve(callback(transaction)),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpaceSessionOpenService,
        { provide: PrismaService, useValue: prismaService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        {
          provide: SpaceReservationsStateService,
          useValue: reservationsStateService,
        },
      ],
    }).compile();

    service = module.get<SpaceSessionOpenService>(SpaceSessionOpenService);
  });

  it('occupied 但无 active session 时委托预约状态服务修复空间状态', async () => {
    const now = new Date('2026-06-07T10:00:00.000Z');
    prismaService.space.findUnique.mockResolvedValue({
      id: 7,
      storeId: 18,
      capacity: 4,
      status: 'occupied',
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
      hourlyRate: new Prisma.Decimal(68),
      timeCost: null,
      countdownMinutes: null,
      autoCheckout: null,
      prepaidPaymentMethod: null,
      prepaidGrouponCode: null,
      prepaidNote: null,
      prepaidAmount: null,
      items: [],
      itemsCost: new Prisma.Decimal(0),
      renewRecords: [],
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
    });

    expect(
      reservationsStateService.repairInconsistentOccupiedSpace,
    ).toHaveBeenCalledWith(7);
  });

  it('带 reservationId 开台时委托预约状态服务做履约校验', async () => {
    const now = new Date('2026-06-07T10:00:00.000Z');
    prismaService.space.findUnique.mockResolvedValue({
      id: 7,
      storeId: 18,
      capacity: 4,
      status: 'idle',
      type: { name: '台球桌' },
    });
    transaction.spaceSession.findFirst.mockResolvedValue(null);
    transaction.spaceReservation.update.mockResolvedValue(undefined);
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
      hourlyRate: new Prisma.Decimal(68),
      timeCost: null,
      countdownMinutes: null,
      autoCheckout: null,
      prepaidPaymentMethod: null,
      prepaidGrouponCode: null,
      prepaidNote: null,
      prepaidAmount: null,
      items: [],
      itemsCost: new Prisma.Decimal(0),
      renewRecords: [],
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
  });
});
