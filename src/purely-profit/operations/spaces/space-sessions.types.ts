import {
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

/**
 * space_session_items 表行类型（Prisma include 返回）
 */
export interface SpaceSessionItemRow {
  id: number;
  sessionId: number;
  productId: string;
  productName: string;
  categoryName: string;
  salePrice: number;
  profit: number;
  quantity: number;
  sortOrder: number;
  createdAt: Date;
}

/**
 * space_session_renew_records 表行类型（Prisma include 返回）
 */
export interface SpaceSessionRenewRecordRow {
  id: number;
  sessionId: number;
  recordId: string;
  amount: number;
  addedMinutes: number;
  paymentMethod: SalesPaymentMethodValue;
  grouponCode: string | null;
  grouponPlatform: string | null;
  voucherFaceAmount?: number | null;
  note: string | null;
  renewedAt: bigint | number;
  createdAt: Date;
}

/**
 * 消费明细记录（业务视图）
 * 从 space_session_items 表查询后映射，不含 DB 元数据
 */
export interface SpaceSessionItemRecord {
  productId: string;
  productName: string;
  categoryName: string;
  salePrice: number;
  profit: number;
  quantity: number;
  /** 行合计金额 = salePrice × quantity（元） */
  lineTotal: number;
}

/**
 * 续费记录（业务视图）
 * 从 space_session_renew_records 表查询后映射
 * recordId 是业务 ID（rn_{uuid}），id 字段不暴露给前端
 */
export interface SpaceSessionRenewRecord {
  id: string; // 业务 ID (recordId)
  amount: number;
  addedMinutes: number;
  paymentMethod: SalesPaymentMethodValue;
  grouponCode?: string;
  grouponPlatform?: string;
  voucherFaceAmount?: number;
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
  hourlyRate: number | null;
  timeCost: number | null;
  countdownMinutes: number | null;
  autoCheckout: boolean | null;
  prepaidPaymentMethod: SalesPaymentMethodValue | null;
  prepaidCustomerPaymentMethod: string | null;
  prepaidSettlementChannel: string | null;
  prepaidGrouponCode: string | null;
  prepaidGrouponPlatform: string | null;
  prepaidVoucherCode: string | null;
  prepaidVoucherPlatform: string | null;
  prepaidNote: string | null;
  prepaidAmount: number | null;
  prepaidVoucherFaceAmount: number | null;
  /// Step 8.1: items 已拆到 space_session_items 表，通过 include 查询
  sessionItems: SpaceSessionItemRow[];
  itemsCost: number;
  /// Step 8.1: renewRecords 已拆到 space_session_renew_records 表，通过 include 查询
  sessionRenewRecords: SpaceSessionRenewRecordRow[];
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
  /** 向后兼容：联合搜索（有独立字段时忽略） */
  keyword?: string;
  /** 独立姓名搜索（contains 模糊匹配） */
  guestName?: string;
  /** 独立手机号搜索（startsWith 前缀匹配） */
  guestPhone?: string;
  /** 独立空间名称搜索（contains 模糊匹配，仅门店维度） */
  spaceName?: string;
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
  voucherFaceAmount?: number;
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
