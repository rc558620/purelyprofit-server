// 纯利宝团购券订单：业务订单号与券码生成工具
import { randomBytes, randomInt } from 'node:crypto';
import { CLUB_VOUCHER_ORDER_NO_PREFIX } from './club-voucher-orders.types';

/** 数字补零 */
const pad = (value: number, width = 2): string =>
  String(value).padStart(width, '0');

/** 上海时区时间分量串（与营业日口径一致） */
const buildShanghaiSerial = (now: number): string => {
  const shanghai = new Date(now + 8 * 60 * 60_000);
  return [
    shanghai.getUTCFullYear(),
    pad(shanghai.getUTCMonth() + 1),
    pad(shanghai.getUTCDate()),
    pad(shanghai.getUTCHours()),
    pad(shanghai.getUTCMinutes()),
    pad(shanghai.getUTCSeconds()),
    pad(shanghai.getUTCMilliseconds(), 3),
    randomBytes(2).toString('hex').toUpperCase(),
  ].join('');
};

/**
 * 生成团购券业务订单号（微信 out_trade_no，回调按 VC 前缀路由）
 * 格式：VC + 年月日时分秒毫秒 + 4 位随机 HEX
 */
export const buildVoucherOrderNo = (now: number): string =>
  `${CLUB_VOUCHER_ORDER_NO_PREFIX}${buildShanghaiSerial(now)}`;

/**
 * 生成团购券码（支付成功后生成，全局唯一，供商家开台读取）
 * 格式：12 位纯数字（美团风格长度，数字键盘友好），唯一索引 + 生成查重兜底防碰撞
 */
export const buildVoucherCode = (): string =>
  String(randomInt(10 ** 11, 10 ** 12));
