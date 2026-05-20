import { Test, TestingModule } from '@nestjs/testing';
import {
  Prisma,
  SpaceBillingMode as PrismaSpaceBillingMode,
  SpaceSessionStatus as PrismaSpaceSessionStatus,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { SalesRecordService } from '../sales-record/sales-record.service';
import { SpacesService } from './spaces.service';
import { ConfigService } from '@nestjs/config';

describe('SpacesService', () => {
  let service: SpacesService;

  const prismaService = {
    spaceSession: {
      findUnique: jest.fn(),
    },
  };

  const commerceAccessService = {
    ensureCanAccessStore: jest.fn(),
  };

  const salesRecordService = {};

  const redisService = {
    set: jest.fn(),
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
    currentMembership: {
      staffId: 8,
      storeId: 18,
      role: 'OWNER',
      permissions: ['*'],
      isActive: true,
    },
  };

  const makeSession = (
    billingMode: PrismaSpaceBillingMode,
    overrides: Record<string, unknown> = {},
  ) => ({
    id: 11,
    storeId: 18,
    spaceId: 3,
    space: {
      id: 3,
      name: 'A台',
      enableDirtyRoom: false,
      type: { name: '台球台' },
    },
    reservationId: null,
    guestName: '张三',
    guestPhone: null,
    guestCount: 2,
    startTime: new Date('2026-05-18T10:11:00.000Z'),
    endTime: null,
    billingMode,
    hourlyRate: new Prisma.Decimal('40'),
    timeCost: null,
    countdownMinutes: null,
    autoCheckout: false,
    prepaidPaymentMethod: null,
    prepaidGrouponCode: null,
    prepaidNote: null,
    prepaidAmount: null,
    items: [],
    itemsCost: new Prisma.Decimal('0'),
    renewRecords: [],
    status: PrismaSpaceSessionStatus.active,
    saleOrderId: null,
    createdAt: new Date('2026-05-18T10:00:00.000Z'),
    ...overrides,
  });

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-18T11:00:00.000Z'));
    jest.clearAllMocks();
    commerceAccessService.ensureCanAccessStore.mockResolvedValue(undefined);
    redisService.set.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpacesService,
        { provide: PrismaService, useValue: prismaService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        { provide: SalesRecordService, useValue: salesRecordService },
        { provide: RedisService, useValue: redisService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<SpacesService>(SpacesService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('previewSpaceSessionCheckout 在倒计时固定台位费时返回 unit_price / fixed', async () => {
    prismaService.spaceSession.findUnique.mockResolvedValue(
      makeSession(PrismaSpaceBillingMode.countdown),
    );

    const result = await service.previewSpaceSessionCheckout(user, 11, {
      countdownFeeMode: 'fixed',
    });

    expect(result.preview).toEqual(expect.objectContaining({
      durationMinutes: 49,
      durationLabel: '49分钟',
      timeCost: 40,
      itemsCost: 0,
      renewDeduction: 0,
      prepaidDeduction: 0,
      totalAmount: 40,
      timeFeeMode: 'unit_price',
      countdownFeeMode: 'fixed',
    }));
  });

  it('previewSpaceSessionCheckout 在倒计时按实际计时时返回 timed / timed', async () => {
    prismaService.spaceSession.findUnique.mockResolvedValue(
      makeSession(PrismaSpaceBillingMode.countdown, {
        renewRecords: [
          {
            id: 'renew_1',
            amount: 20,
            addedMinutes: 30,
            paymentMethod: 'cash',
            renewedAt: new Date('2026-05-18T10:30:00.000Z').getTime(),
          },
        ],
      }),
    );

    const result = await service.previewSpaceSessionCheckout(user, 11, {
      countdownFeeMode: 'timed',
    });

    expect(result.preview).toEqual(expect.objectContaining({
      durationMinutes: 49,
      durationLabel: '49分钟',
      timeCost: 32.67,
      itemsCost: 0,
      renewDeduction: 20,
      prepaidDeduction: 0,
      totalAmount: 12.67,
      timeFeeMode: 'timed',
      countdownFeeMode: 'timed',
    }));
  });

  it('previewSpaceSessionCheckout 在计时模式时返回 timed / timed', async () => {
    prismaService.spaceSession.findUnique.mockResolvedValue(
      makeSession(PrismaSpaceBillingMode.timed),
    );

    const result = await service.previewSpaceSessionCheckout(user, 11, {});

    expect(result.preview).toEqual(expect.objectContaining({
      durationMinutes: 49,
      durationLabel: '49分钟',
      timeCost: 32.67,
      itemsCost: 0,
      renewDeduction: 0,
      prepaidDeduction: 0,
      totalAmount: 32.67,
      timeFeeMode: 'timed',
      countdownFeeMode: 'timed',
    }));
  });
});
