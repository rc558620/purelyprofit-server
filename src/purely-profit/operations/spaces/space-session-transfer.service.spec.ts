import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, SpaceStatus as PrismaSpaceStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { SpaceReservationsStateService } from './space-reservations-state.service';
import { SpaceSessionTransferService } from './space-session-transfer.service';

describe('SpaceSessionTransferService', () => {
  let service: SpaceSessionTransferService;

  const transaction = {
    spaceSession: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    space: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const prismaService = {
    spaceSession: {
      findUnique: jest.fn(),
    },
    space: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const commerceAccessService = {
    ensureCanAccessStore: jest.fn(),
  };

  const reservationsStateService = {
    resolveReservationBackStatus: jest.fn(),
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
    reservationsStateService.resolveReservationBackStatus.mockResolvedValue(
      PrismaSpaceStatus.reserved,
    );
    prismaService.$transaction.mockImplementation((callback) =>
      Promise.resolve(callback(transaction)),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpaceSessionTransferService,
        { provide: PrismaService, useValue: prismaService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        {
          provide: SpaceReservationsStateService,
          useValue: reservationsStateService,
        },
      ],
    }).compile();

    service = module.get<SpaceSessionTransferService>(
      SpaceSessionTransferService,
    );
  });

  it('换房时源空间回退状态委托预约状态服务计算', async () => {
    const now = new Date('2026-06-07T10:00:00.000Z');
    prismaService.spaceSession.findUnique.mockResolvedValue({
      id: 5,
      storeId: 18,
      spaceId: 7,
      autoCheckout: false,
      status: 'active',
      space: {
        id: 7,
        name: 'A01',
        storeId: 18,
        enableDirtyRoom: false,
        autoCheckout: false,
        type: {
          id: 101,
          name: '台球桌',
        },
      },
    });
    prismaService.space.findUnique.mockResolvedValue({
      id: 11,
      storeId: 18,
      name: 'A02',
      status: 'idle',
      typeId: 101,
      enableDirtyRoom: false,
      autoCheckout: false,
    });
    transaction.spaceSession.findUnique.mockResolvedValue({
      id: 5,
      storeId: 18,
      spaceId: 7,
      autoCheckout: false,
      status: 'active',
      space: {
        id: 7,
        name: 'A01',
        storeId: 18,
        enableDirtyRoom: false,
        autoCheckout: false,
        type: {
          id: 101,
          name: '台球桌',
        },
      },
    });
    transaction.space.findUnique.mockResolvedValue({
      id: 11,
      storeId: 18,
      status: 'idle',
      typeId: 101,
      enableDirtyRoom: false,
      autoCheckout: false,
    });
    transaction.spaceSession.update.mockResolvedValue({
      id: 5,
      storeId: 18,
      spaceId: 11,
      reservationId: null,
      guestName: '张三',
      guestPhone: '13800138000',
      guestCount: 2,
      startTime: now,
      endTime: null,
      billingMode: 'timed',
      hourlyRate: new Prisma.Decimal(68),
      timeCost: null,
      countdownMinutes: null,
      autoCheckout: false,
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
        id: 11,
        name: 'A02',
        type: { name: '台球桌' },
      },
    });
    transaction.space.update.mockResolvedValue(undefined);

    const result = await service.transferSession(user, 5, {
      targetSpaceId: 11,
    });

    expect(
      reservationsStateService.resolveReservationBackStatus,
    ).toHaveBeenCalledWith(transaction, 7);
    expect(result.sourceSpaceStatus).toBe('reserved');
    expect(result.targetSpaceStatus).toBe('occupied');
  });
});
