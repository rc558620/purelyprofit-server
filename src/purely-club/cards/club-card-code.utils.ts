/**
 * 购卡订单号 / 卡号生成。
 *
 * 两类编码都靠「订单号全局唯一」推导，不做随机碰撞重试：
 * - 订单号 `MC + 毫秒时间戳 + 随机 HEX`，同时作为微信 out_trade_no；
 * - 卡号由订单号派生（`K` + 订单号主体 + 同单序号），因此同门店内天然唯一，
 *   不必像券码那样反复查询数据库确认是否撞号。
 *
 * ⚠️ 订单号长度：前缀 2 + 时间戳 13 + HEX 8 = 23 字符，
 * 与 member_card_orders.order_no（VARCHAR 64）、
 * member_cards.card_no（VARCHAR 64）都有充足余量。
 */
import { randomBytes } from 'node:crypto';
import { CLUB_CARD_ORDER_NO_PREFIX } from './club-cards.constants';

/** 生成购卡业务订单号（同时作为微信支付 out_trade_no） */
export function buildCardOrderNo(nowMs: number): string {
  return `${CLUB_CARD_ORDER_NO_PREFIX}${nowMs}${randomBytes(4)
    .toString('hex')
    .toUpperCase()}`;
}

/**
 * 由订单号派生卡号。
 *
 * @param orderNo 购卡订单号（全局唯一）
 * @param index 同一订单内的第几张卡（从 0 开始）
 */
export function buildCardNo(orderNo: string, index: number): string {
  const base = `K${orderNo.slice(CLUB_CARD_ORDER_NO_PREFIX.length)}`;
  return index === 0 ? base : `${base}-${index + 1}`;
}

/** 解析卡模板 ID（C 端入参为字符串，数据库主键为整数） */
export function parseCardId(raw: string): number | null {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}
