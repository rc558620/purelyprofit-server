import {
  Prisma,
  SpaceBillingMode,
  SpaceSessionStatus,
  SpaceStatus,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type { SalesRecordResponseDto } from '../sales-record/dto/sales-record.dto';
import type {
  SettleSpaceSessionParams,
  SettleSpaceSessionResult,
} from './space-session-settlement.service';
import type { SpaceSessionSettlementRecord } from './space-sessions.types';

export const createSpaceTestUser = (): AuthenticatedUser => ({
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
});

export const createSpaceCheckoutAt = (): number =>
  new Date(2026, 5, 4, 10, 30, 0).getTime();

export const createSalesOrderResponse = (): SalesRecordResponseDto =>
  ({ id: '12', orderNo: '#20260604-001' }) as SalesRecordResponseDto;

export const createSpaceSessionRecord = (): SpaceSessionSettlementRecord =>
  ({
    id: 9,
    storeId: 18,
    spaceId: 7,
    reservationId: 5,
    guestName: '张三',
    guestPhone: '13800138000',
    guestCount: 2,
    startTime: new Date(2026, 5, 4, 9, 0, 0),
    endTime: null,
    billingMode: SpaceBillingMode.items,
    hourlyRate: null,
    timeCost: null,
    countdownMinutes: null,
    autoCheckout: false,
    prepaidPaymentMethod: null,
    prepaidGrouponCode: null,
    prepaidNote: null,
    prepaidAmount: null,
    items: [
      {
        productId: '201',
        productName: '可乐',
        categoryName: '饮品',
        salePrice: 20,
        profit: 8,
        quantity: 1,
      },
    ],
    itemsCost: new Prisma.Decimal(20),
    renewRecords: [],
    status: SpaceSessionStatus.active,
    saleOrderId: null,
    createdAt: new Date(2026, 5, 4, 9, 0, 0),
    updatedAt: new Date(2026, 5, 4, 9, 30, 0),
    space: {
      id: 7,
      name: 'A01',
      enableDirtyRoom: true,
      type: {
        name: '台球桌',
      },
    },
  }) as SpaceSessionSettlementRecord;

export const createSettleSpaceSessionParams = (): SettleSpaceSessionParams => ({
  session: createSpaceSessionRecord(),
  checkoutAt: createSpaceCheckoutAt(),
  paymentMethod: 'cash',
  note: '空间结账',
  settlement: {
    durationMinutes: 90,
    durationLabel: '1小时30分钟',
    timeCost: 0,
    itemsCost: 20,
    renewDeduction: 0,
    prepaidDeduction: 0,
    totalAmount: 20,
    orderItems: [
      {
        productId: '201',
        productName: '可乐',
        categoryName: '饮品',
        salePrice: 20,
        profit: 8,
        quantity: 1,
      },
    ],
    totalRevenue: 20,
    totalProfit: 8,
    totalQuantity: 1,
  },
  renewRecords: [],
});

export const createUpdatedSpaceSession = () => {
  const checkoutAt = createSpaceCheckoutAt();
  const session = createSpaceSessionRecord();
  return {
    ...session,
    endTime: new Date(checkoutAt),
    timeCost: new Prisma.Decimal(0),
    status: SpaceSessionStatus.settled,
    saleOrderId: 12,
  };
};

export const createSettleSpaceSessionResult = (): SettleSpaceSessionResult => ({
  session: createUpdatedSpaceSession(),
  spaceStatus: SpaceStatus.cleaning,
  cancelledReservationId: null,
  salesOrder: createSalesOrderResponse(),
});

export const expectedSalesRecordCreateOptions = {
  skipInventoryValidationAndDeduction: true,
  skipAccessCheck: true,
  assignToCurrentShiftOperator: true,
} as const;

export const createSpaceTransactionClient = () => ({
  spaceSession: {
    update: jest.fn(),
  },
  space: {
    update: jest.fn(),
  },
  spaceReservation: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
});
