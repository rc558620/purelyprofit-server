import {
  SpaceBillingMode as PrismaSpaceBillingMode,
  SpaceSessionStatus as PrismaSpaceSessionStatus,
  type Prisma,
} from '@prisma/client';
import { Money } from '../../../shared/money.utils';
import type { CommissionAssignmentRecord } from '../commission/commission.types';
import type { NormalizedOpenSessionPayload } from './space-sessions.types';
import type { SpaceBillingModeValue } from './spaces.constants';

/** 开台所需的门店空间上下文（含类型快照，供会员卡模板限制校验） */
export interface OpenSessionSpaceContext {
  id: number;
  name: string;
  storeId: number;
  capacity: number | null;
  autoCheckout: boolean;
  type: { id: number; name: string };
}

/** 开台落库入参：操作员快照与提成分配均在事务外/事务内提前解析完毕 */
export interface BuildOpenSessionCreateDataInput {
  space: OpenSessionSpaceContext;
  payload: NormalizedOpenSessionPayload;
  openOperatorStaffId: number | null;
  openOperatorNameSnapshot: string | null;
  commissionAssignments: CommissionAssignmentRecord[] | undefined;
}

const toPrismaSpaceBillingMode = (
  value: SpaceBillingModeValue,
): PrismaSpaceBillingMode => value;

/**
 * 构造开台会话落库数据：字段顺序、单位（分）与语义与拆分前逐字一致。
 */
export const buildOpenSessionCreateData = (
  input: BuildOpenSessionCreateDataInput,
): Prisma.SpaceSessionUncheckedCreateInput => {
  const {
    space,
    payload,
    openOperatorStaffId,
    openOperatorNameSnapshot,
    commissionAssignments,
  } = input;

  return {
    storeId: space.storeId,
    spaceId: space.id,
    reservationId: payload.reservationId,
    guestName: payload.guestName ?? null,
    guestPhone: payload.guestPhone ?? null,
    guestCount: payload.guestCount ?? null,
    // 开台识别到的会员与本次核销的持卡实例：结账据此取储值余额 / 卡抵扣
    customerId: payload.customerId ?? null,
    activeCardId: payload.activeCardId ?? null,
    startTime: new Date(),
    billingMode: toPrismaSpaceBillingMode(payload.billingMode),
    hourlyRate:
      payload.hourlyRate !== undefined
        ? Money.fromInputYuan(payload.hourlyRate).toDbCents()
        : null,
    countdownMinutes: payload.countdownMinutes ?? null,
    // B4 fix: autoCheckout 未传时继承空间配置，避免运行态与会话级漂移，
    // 同时保证换房强校验 Boolean(session.autoCheckout) !== targetSpace.autoCheckout 有意义。
    autoCheckout: payload.autoCheckout ?? space.autoCheckout ?? null,
    prepaidPaymentMethod: payload.prepaidPaymentMethod ?? null,
    prepaidCustomerPaymentMethod: payload.prepaidCustomerPaymentMethod ?? null,
    prepaidSettlementChannel: payload.prepaidSettlementChannel ?? null,
    prepaidGrouponCode: payload.prepaidGrouponCode ?? null,
    prepaidGrouponPlatform: payload.prepaidGrouponPlatform ?? null,
    prepaidVoucherCode: payload.prepaidVoucherCode ?? null,
    prepaidVoucherPlatform: payload.prepaidVoucherPlatform ?? null,
    prepaidNote: payload.prepaidNote ?? null,
    prepaidAmount:
      payload.prepaidAmount !== undefined
        ? Money.fromInputYuan(payload.prepaidAmount).toDbCents()
        : null,
    prepaidVoucherFaceAmount:
      payload.prepaidVoucherFaceAmount !== undefined
        ? Money.fromInputYuan(payload.prepaidVoucherFaceAmount).toDbCents()
        : null,
    /// Step 8.1: items/renewRecords 已拆为独立表，开台时为空
    itemsCost: 0,
    openOperatorStaffId,
    openOperatorNameSnapshot,
    ...(commissionAssignments
      ? {
          commissionAssignments:
            commissionAssignments as unknown as Prisma.InputJsonValue,
        }
      : {}),
    status: PrismaSpaceSessionStatus.active,
  };
};
