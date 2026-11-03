import type { SalesRecordResponseDto } from '../sales-record/dto/sales-record.dto';
import type { SalesPaymentMethodValue } from '../sales-record/sales-record.types';
import type { SpaceTimeFeeModeValue } from './dto/space-session.constants';
import type { SpaceStatusValue } from './spaces.constants';
import type {
  CheckoutSettlementInput,
  GrouponVoucherCostSnapshot,
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
  /**
   * 开台团购券对应商品名（purelyClub 团购商品名，如「分手大师」）。
   * 事务内重建 settlement 时需要它来还原正向券面行的展示名，
   * 保证与结账预览展示/落库的销售单明细完全一致。
   */
  voucherProductName?: string | null;
  /**
   * 开台团购券商品的成本快照（下单时固化）。
   * 事务内重建 settlement 时需要它来还原正向券面行的利润（券面 - 成本），
   * 保证与结账预览落库的销售单明细完全一致。
   */
  voucherCost?: GrouponVoucherCostSnapshot;
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
   * 请求追踪 ID：透传给结账后置动作（如护理档案建档）的失败日志，
   * 便于把「建档失败」与一次具体结账请求关联起来。自动结账链路无 HTTP 请求，可缺省。
   */
  requestId?: string;
  /**
   * BUG-3 fix: 跳过将 voucherFaceAmount 写入 session.prepaidVoucherFaceAmount。
   * 当 voucherFaceAmount 来自续费团购回退（renewGrouponFallback）时设为 true，
   * 防止续费券面金额污染预付池字段，保持「两池独立」不变量。
   */
  skipPrepaidVoucherPersistence?: boolean;
  /**
   * be-06：结账多资产抵扣明细（卡 / 券 / 余额），已由 DTO 归一化。
   * 金额仅作「前端预期」，后端在事务内按权威结算结果重新夹紧额度上限。
   * 缺省时仍会按 session.activeCardId 确认开台绑定的次数卡，避免预扣次数泄漏。
   */
  settlements?: CheckoutSettlementInput[];
  /**
   * be-06：抵扣后的前端预期应付（元）。
   * 事务内与后端权威应收比对，不一致直接拒绝（锁单过期/并发改单导致的金额漂移）。
   * 缺省（自动结账等无前端场景）时跳过比对。
   */
  expectedPayable?: number;
}

export interface SettleSpaceSessionResult {
  session: SpaceSessionRecord;
  cancelledReservationId: number | null;
  salesOrder: SalesRecordResponseDto;
  /** 事务内推导的结算后空间状态（BUG-8 修复：保证与写入一致） */
  spaceStatus: SpaceStatusValue;
}
