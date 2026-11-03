// 售卡订单行数据 → 接口响应：分转元、Date 转毫秒、手机号明文透出
import type { MemberCardOrder } from '@prisma/client';
import { Money } from '../../../shared/money.utils';
import type { MemberCardOrderDto } from './dto/member-card-order.response.dto';
import { resolveDisplayPhone } from './member-card.utils';

/**
 * 单条售卡订单的响应映射。
 *
 * 金额只允许经 Money 换算，禁止在这里手写 /100；
 * 库内 `customerPhone` 是明文快照（对账需要），对外按完整号码透出，
 * 无法归一化的占位号码（如 club_wechat:xxx）归一化后为空，此时不下发该字段。
 */
export function mapMemberCardOrder(row: MemberCardOrder): MemberCardOrderDto {
  return {
    id: String(row.id),
    orderNo: row.orderNo,
    planNameSnapshot: row.planNameSnapshot,
    kind: row.kind,
    amount: Money.fromDbCents(row.amount).toOutputYuan(),
    quantity: row.quantity,
    source: row.source,
    status: row.status,
    customerName: row.customerName ?? undefined,
    customerPhone: resolveDisplayPhone(row.customerPhone),
    operatorName: row.operatorName ?? undefined,
    paidAt: row.paidAt === null ? undefined : row.paidAt.getTime(),
    createdAt: row.createdAt.getTime(),
  };
}
