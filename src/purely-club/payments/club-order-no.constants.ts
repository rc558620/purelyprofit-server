/**
 * C 端订单号前缀：全仓唯一事实来源。
 *
 * 独立成文件的原因：前缀解析被回调路由、死信记录、商户号回读等多条链路复用，
 * 若寄生在某个 Injectable service 里，纯常量消费者会间接拉起整张支付依赖图，
 * 并与退款服务形成循环 import，导致 Nest 在测试/启动时解析不到 provider。
 */
import { BadRequestException } from '@nestjs/common';
import { CLUB_PAY_ERROR_CODE, clubPayError } from './club-pay.errors';

/** 订单号前缀 → 订单类型映射 */
export const ORDER_NO_TYPE_MAP: Record<
  string,
  | 'recharge'
  | 'service'
  | 'scan_ordering'
  | 'voucher'
  | 'self_ordering'
  | 'card'
> = {
  RC: 'recharge',
  SV: 'service',
  SO: 'scan_ordering',
  VC: 'voucher',
  SF: 'self_ordering',
  MC: 'card',
};

/** 订单号格式正则：前缀（RC/SV/SO/VC/SF/MC）+ 时间戳 + 随机 HEX */
export const ORDER_NO_PATTERN = /^(?:RC|SV|SO|VC|SF|MC)[A-Za-z0-9-]+$/;

/**
 * 校验映射与正则前缀一致。
 * 新增订单类型时必须同时更新两处，否则此断言在服务启动时就会失败。
 */
const PATTERN_PREFIXES =
  ORDER_NO_PATTERN.source.match(/\(\?:([^)]+)\)/)?.[1]?.split('|') ?? [];
const MAP_PREFIXES = Object.keys(ORDER_NO_TYPE_MAP);
if (PATTERN_PREFIXES.length > 0 && MAP_PREFIXES.length > 0) {
  const missingInMap = PATTERN_PREFIXES.filter(
    (prefix) => !MAP_PREFIXES.includes(prefix),
  );
  const missingInPattern = MAP_PREFIXES.filter(
    (prefix) => !PATTERN_PREFIXES.includes(prefix),
  );
  if (missingInMap.length > 0 || missingInPattern.length > 0) {
    throw new Error(
      `[club-order-no] 订单号前缀映射不一致: ` +
        `ORDER_NO_PATTERN 包含 ${PATTERN_PREFIXES.join('/')}，` +
        `ORDER_NO_TYPE_MAP 包含 ${MAP_PREFIXES.join('/')}，` +
        `缺失: map中缺 ${missingInMap.join('/')}, pattern中缺 ${missingInPattern.join('/')}`,
    );
  }
}

export type ClubOrderTypeByOrderNo = (typeof ORDER_NO_TYPE_MAP)[string];

/** 按订单号前缀解析订单类型；未知前缀返回 null，供「跳过校验」类旁路链路使用 */
export function tryResolveClubOrderTypeByOrderNo(
  orderNo: string,
): ClubOrderTypeByOrderNo | null {
  return ORDER_NO_TYPE_MAP[orderNo.slice(0, 2).toUpperCase()] ?? null;
}

/** 按订单号前缀解析订单类型；未知前缀抛参数类异常 */
export function resolveClubOrderTypeByOrderNo(
  orderNo: string,
): ClubOrderTypeByOrderNo {
  const orderType = tryResolveClubOrderTypeByOrderNo(orderNo);
  if (!orderType) {
    throw new BadRequestException(
      clubPayError(
        CLUB_PAY_ERROR_CODE.PARAM_ORDER_NO_PREFIX_UNKNOWN,
        `无法从订单号识别订单类型: ${orderNo}（期望前缀 RC / SV / SO / VC / SF / MC）`,
      ),
    );
  }
  return orderType;
}
