import {
  Prisma,
  SpaceBillingMode as PrismaSpaceBillingMode,
  SpaceSessionStatus as PrismaSpaceSessionStatus,
} from '@prisma/client';
import type {
  SpaceCountdownFeeModeValue,
  SpaceCustomerPaymentMethodValue,
  SpaceSettlementChannelValue,
  SpaceSettlementStatusValue,
  SpaceTimeFeeModeValue,
} from './dto/space-session.dto';
import type {
  SpaceBillingModeValue,
  SpaceSessionStatusValue,
} from './spaces.constants';
import type { SalesPaymentMethodValue } from '../sales-record/sales-record.types';

export interface SpaceSessionItemRecord {
  productId: string;
  productName: string;
  categoryName: string;
  salePrice: number;
  profit: number;
  quantity: number;
}

export interface SpaceSessionRenewRecord {
  id: string;
  amount: number;
  addedMinutes: number;
  paymentMethod: SalesPaymentMethodValue;
  grouponCode?: string;
  grouponPlatform?: string;
  note?: string;
  renewedAt: number;
}

export interface SpaceSessionRecord {
  id: number;
  storeId: number;
  spaceId: number;
  space: {
    id: number;
    name: string;
    type: {
      name: string;
    };
  };
  reservationId: number | null;
  guestName: string | null;
  guestPhone: string | null;
  guestCount: number | null;
  startTime: Date;
  endTime: Date | null;
  billingMode: PrismaSpaceBillingMode;
  hourlyRate: Prisma.Decimal | null;
  timeCost: Prisma.Decimal | null;
  countdownMinutes: number | null;
  autoCheckout: boolean | null;
  prepaidPaymentMethod: SalesPaymentMethodValue | null;
  prepaidGrouponCode: string | null;
  prepaidNote: string | null;
  prepaidAmount: Prisma.Decimal | null;
  items: Prisma.JsonValue;
  itemsCost: Prisma.Decimal;
  renewRecords: Prisma.JsonValue;
  status: PrismaSpaceSessionStatus;
  saleOrderId: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SpaceSessionListQuery {
  page?: number;
  pageSize?: number;
  status?: SpaceSessionStatusValue;
  includeActive?: boolean;
  keyword?: string;
  rangeStartDate?: number;
  rangeEndDate?: number;
}

export interface SpaceSessionCheckoutLockPayload {
  sessionId: number;
  lockedAt: number;
  expiresAt: number;
  sessionUpdatedAt: number;
  timeFeeMode?: SpaceTimeFeeModeValue;
  countdownFeeMode?: SpaceCountdownFeeModeValue;
}

export interface CheckoutPreviewFeeMode {
  timeFeeMode?: SpaceTimeFeeModeValue;
  countdownFeeMode?: SpaceCountdownFeeModeValue;
}

export interface NormalizedCheckoutPayload {
  paymentMethod: SalesPaymentMethodValue;
  note?: string;
  grouponCode?: string;
  grouponPlatform?: string;
  customerPaymentMethod?: SpaceCustomerPaymentMethodValue;
  settlementChannel?: SpaceSettlementChannelValue;
  voucherCode?: string;
  voucherPlatform?: string;
  voucherFaceAmount?: number;
  settlementStatus?: SpaceSettlementStatusValue;
  platformReceivable?: number;
  platformSettledAmount?: number;
  platformFee?: number;
  timeFeeMode?: SpaceTimeFeeModeValue;
  countdownFeeMode?: SpaceCountdownFeeModeValue;
  lockId: string;
  lockedAt: number;
}

export interface NormalizedOpenSessionPayload {
  guestName?: string;
  guestPhone?: string;
  guestCount?: number;
  billingMode: SpaceBillingModeValue;
  hourlyRate?: number;
  countdownMinutes?: number;
  autoCheckout?: boolean;
  reservationId?: number;
  prepaidPaymentMethod?: SalesPaymentMethodValue;
  prepaidCustomerPaymentMethod?: SpaceCustomerPaymentMethodValue;
  prepaidSettlementChannel?: SpaceSettlementChannelValue;
  prepaidGrouponCode?: string;
  prepaidGrouponPlatform?: string;
  prepaidVoucherCode?: string;
  prepaidVoucherPlatform?: string;
  prepaidNote?: string;
  prepaidAmount?: number;
  prepaidVoucherFaceAmount?: number;
}

export interface NormalizedRenewPayload {
  amount: number;
  paymentMethod: SalesPaymentMethodValue;
  grouponCode?: string;
  grouponPlatform?: string;
  note?: string;
}

export interface SpaceSessionSettlement {
  durationMinutes: number;
  durationLabel: string;
  timeFeeMode?: SpaceTimeFeeModeValue;
  countdownFeeMode?: SpaceCountdownFeeModeValue;
  timeCost: number;
  itemsCost: number;
  renewDeduction: number;
  prepaidDeduction: number;
  totalAmount: number;
  orderItems: SpaceSessionItemRecord[];
  totalRevenue: number;
  totalProfit: number;
  totalQuantity: number;
}

export type SpaceSessionSettlementRecord = SpaceSessionRecord & {
  space: {
    id: number;
    name: string;
    enableDirtyRoom: boolean;
    type: { name: string };
  };
};
