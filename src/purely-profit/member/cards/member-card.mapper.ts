// 持卡实例 / 核销流水行数据 → 接口响应：分转元、Date 转毫秒、顾客信息回填、手机号明文透出
import type { MemberCard, MemberCardTransaction } from '@prisma/client';
import { Money } from '../../../shared/money.utils';
import type { MemberVoucherAssetDto } from './dto/member-card-identify.response.dto';
import type {
  MemberCardDto,
  MemberCardTransactionDto,
} from './dto/member-card.response.dto';
import { calcRemainingDays, resolveDisplayPhone } from './member-card.utils';

/** 持卡关联的顾客最小信息集（由 marketing_customers 批量反查得到） */
export interface MemberCardCustomerSnapshot {
  name: string;
  phone: string | null;
}

/** 可用团购券的最小字段集（只取开台抵扣需要的列，不读任何明细） */
export interface MemberVoucherAssetSnapshot {
  voucherCode: string | null;
  productName: string;
  paidAmountFen: number;
  expiresAt: Date | null;
}

/**
 * 单张持卡的响应映射。
 *
 * 金额只允许经 Money 换算，禁止在这里手写 /100；
 * 手机号走 resolveDisplayPhone 明文透出（商家端对账 / 回访需要完整号码），
 * 占位手机号（club_wechat:xxx）与脏数据归一化后为空，此时不下发该字段，
 * 避免前端把占位值当真实号码展示。
 */
export function mapMemberCard(
  row: MemberCard,
  customer: MemberCardCustomerSnapshot | undefined,
  nowMs: number,
): MemberCardDto {
  return {
    id: String(row.id),
    cardNo: row.cardNo,
    kind: row.kind,
    nameSnapshot: row.nameSnapshot,
    customerId: String(row.customerId),
    customerName: customer?.name,
    customerPhone: resolveDisplayPhone(customer?.phone),
    status: row.status,
    startsAt: row.startsAt.getTime(),
    expiresAt: row.expiresAt === null ? undefined : row.expiresAt.getTime(),
    totalTimes: row.totalTimes ?? undefined,
    usedTimes: row.usedTimes ?? undefined,
    remainTimes: row.remainTimes ?? undefined,
    pricePaid: Money.fromDbCents(row.pricePaid).toOutputYuan(),
    sourceType: row.sourceType,
    remainingDays: calcRemainingDays(row.expiresAt, nowMs),
    createdAt: row.createdAt.getTime(),
  };
}

/**
 * 可用团购券的响应映射。
 *
 * 券面金额取「支付成功后的实付金额」：团购券的抵扣上限就是顾客当初为这件
 * 商品实付的钱，用商品标价会与结账抵扣口径对不上。券码缺失的行由查询层
 * 直接排除，这里的空串兜底只防脏数据抛错。
 */
export function mapMemberVoucherAsset(
  row: MemberVoucherAssetSnapshot,
): MemberVoucherAssetDto {
  return {
    code: row.voucherCode ?? '',
    productName: row.productName,
    faceAmount: Money.fromDbCents(row.paidAmountFen).toOutputYuan(),
    expiresAt: row.expiresAt === null ? undefined : row.expiresAt.getTime(),
  };
}

/** 单条核销流水的响应映射：台位名称由快照字段透出，前端按 relatedSpaceName 读取 */
export function mapMemberCardTransaction(
  row: MemberCardTransaction,
): MemberCardTransactionDto {
  return {
    id: String(row.id),
    cardId: String(row.cardId),
    changeType: row.changeType,
    status: row.status,
    deltaTimes: row.deltaTimes,
    beforeTimes: row.beforeTimes ?? undefined,
    afterTimes: row.afterTimes ?? undefined,
    relatedSessionId:
      row.relatedSessionId === null ? undefined : String(row.relatedSessionId),
    relatedSpaceName: row.relatedSpaceNameSnapshot ?? undefined,
    relatedSaleOrderNo: row.relatedSaleOrderNo ?? undefined,
    operatorType: row.operatorType,
    operatorName: row.operatorName ?? undefined,
    remark: row.remark ?? undefined,
    createdAt: row.createdAt.getTime(),
  };
}
