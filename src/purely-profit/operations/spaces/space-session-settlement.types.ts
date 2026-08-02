import type { SalesRecordResponseDto } from '../sales-record/dto/sales-record.dto';
import type { SalesPaymentMethodValue } from '../sales-record/sales-record.types';
import type { SpaceTimeFeeModeValue } from './dto/space-session.constants';
import type { SpaceStatusValue } from './spaces.constants';
import type {
  SpaceSessionRecord,
  SpaceSessionRenewRecord,
  SpaceSessionSettlement,
  SpaceSessionSettlementRecord,
} from './space-sessions.types';

export interface SettleSpaceSessionParams {
  session: SpaceSessionSettlementRecord;
  checkoutAt: number;
  paymentMethod: SalesPaymentMethodValue;
  note?: string;
  settlement: SpaceSessionSettlement;
  renewRecords: SpaceSessionRenewRecord[];
  // ①②④ 修复：结账侧团购/券/平台结算字段，传入后更新 prepaid* 列
  grouponCode?: string;
  grouponPlatform?: string;
  customerPaymentMethod?: string;
  settlementChannel?: string;
  voucherCode?: string;
  voucherPlatform?: string;
  voucherFaceAmount?: number; // 元，落库转分
  // ① 修复：平台结算字段，落新列
  settlementStatus?: string;
  platformReceivable?: number; // 元，落库转分
  platformSettledAmount?: number; // 元，落库转分
  platformFee?: number; // 元，落库转分
  // ⑤ 修复：台位费口径审计字段
  timeFeeMode?: SpaceTimeFeeModeValue;
  /**
   * BUG-3 fix: 跳过将 voucherFaceAmount 写入 session.prepaidVoucherFaceAmount。
   * 当 voucherFaceAmount 来自续费团购回退（renewGrouponFallback）时设为 true，
   * 防止续费券面金额污染预付池字段，保持「两池独立」不变量。
   */
  skipPrepaidVoucherPersistence?: boolean;
}

export interface SettleSpaceSessionResult {
  session: SpaceSessionRecord;
  cancelledReservationId: number | null;
  salesOrder: SalesRecordResponseDto;
  /** 事务内推导的结算后空间状态（BUG-8 修复：保证与写入一致） */
  spaceStatus: SpaceStatusValue;
}
