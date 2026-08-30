import { SpaceSessionStatus as PrismaSpaceSessionStatus } from '@prisma/client';
import { Money } from '../../../shared/money.utils';
import type { CommissionAssignmentRecord } from '../commission/commission.types';
import type { SpaceSessionSettlement } from './space-sessions.types';

/**
 * 构建结账时写入 spaceSession 的结算数据对象。
 * 将 params 中的团购/券/平台字段映射到 prepaid* 列及平台结算列。
 */
export const buildCheckoutSettlementData = (params: {
  checkoutAt: number;
  freshSettlement: SpaceSessionSettlement;
  saleOrderId: number;
  grouponCode?: string;
  grouponPlatform?: string;
  customerPaymentMethod?: string;
  settlementChannel?: string;
  voucherCode?: string;
  voucherPlatform?: string;
  voucherFaceAmount?: number;
  skipPrepaidVoucherPersistence?: boolean;
  settlementStatus?: string;
  platformReceivable?: number;
  platformSettledAmount?: number;
  platformFee?: number;
  timeFeeMode?: string;
  /** 结账重算后的技师提成分配快照（金额为分），传入时回写会话 */
  commissionAssignments?: CommissionAssignmentRecord[];
}): Record<string, unknown> => {
  const data: Record<string, unknown> = {
    endTime: new Date(params.checkoutAt),
    timeCost: Money.fromInputYuan(params.freshSettlement.timeCost).toDbCents(),
    itemsCost: Money.fromInputYuan(
      params.freshSettlement.itemsCost,
    ).toDbCents(),
    status: PrismaSpaceSessionStatus.settled,
    saleOrderId: params.saleOrderId,
  };

  if (params.grouponCode !== undefined) {
    data.prepaidGrouponCode = params.grouponCode;
  }
  if (params.grouponPlatform !== undefined) {
    data.prepaidGrouponPlatform = params.grouponPlatform;
  }
  if (params.customerPaymentMethod !== undefined) {
    data.prepaidCustomerPaymentMethod = params.customerPaymentMethod;
  }
  if (params.settlementChannel !== undefined) {
    data.prepaidSettlementChannel = params.settlementChannel;
  }
  if (params.voucherCode !== undefined) {
    data.prepaidVoucherCode = params.voucherCode;
  }
  if (params.voucherPlatform !== undefined) {
    data.prepaidVoucherPlatform = params.voucherPlatform;
  }
  // BUG-3 fix: 当 voucherFaceAmount 来自续费回退时，不写入 session.prepaidVoucherFaceAmount
  if (
    params.voucherFaceAmount !== undefined &&
    !params.skipPrepaidVoucherPersistence
  ) {
    data.prepaidVoucherFaceAmount = Money.fromInputYuan(
      params.voucherFaceAmount,
    ).toDbCents();
  }

  if (params.settlementStatus !== undefined) {
    data.settlementStatus = params.settlementStatus;
  }
  if (params.platformReceivable !== undefined) {
    data.platformReceivable = Money.fromInputYuan(
      params.platformReceivable,
    ).toDbCents();
  }
  if (params.platformSettledAmount !== undefined) {
    data.platformSettledAmount = Money.fromInputYuan(
      params.platformSettledAmount,
    ).toDbCents();
  }
  if (params.platformFee !== undefined) {
    data.platformFee = Money.fromInputYuan(params.platformFee).toDbCents();
  }
  if (params.timeFeeMode !== undefined) {
    data.timeFeeMode = params.timeFeeMode;
  }
  // 技师提成分配：结账重算后的最终快照（金额为分），保证会话展示与提成记录一致
  if (params.commissionAssignments !== undefined) {
    data.commissionAssignments = params.commissionAssignments;
  }

  return data;
};
