import { BadRequestException, Injectable } from '@nestjs/common';
import { ClubOrderServicePaymentService } from '../orders/club-order-service-payment.service';
import { ClubRechargePaymentService } from '../recharge/club-recharge-payment.service';
import type {
  ClubPaymentCallbackResult,
  ClubPaymentCallbackSettlementParams,
} from './club-payments.types';

/** 订单号前缀 → 订单类型映射 */
const ORDER_NO_TYPE_MAP: Record<string, 'recharge' | 'service'> = {
  RC: 'recharge',
  SV: 'service',
};

/** 订单号格式正则：SV/RC + 年4位+月2位+日2位+时2位+分2位+秒2位+毫秒3位 + 4位HEX */
const ORDER_NO_PATTERN = /^(?:RC|SV)\d{17}[0-9A-Fa-f]{4}$/;

/**
 * 校验 ORDER_NO_TYPE_MAP 的 key 与 ORDER_NO_PATTERN 中的前缀选项一致。
 * 新增订单类型时必须同时更新两处，否则此断言在服务启动时就会失败。
 */
const PATTERN_PREFIXES =
  ORDER_NO_PATTERN.source.match(/\(\?:([^)]+)\)/)?.[1]?.split('|') ?? [];
const MAP_PREFIXES = Object.keys(ORDER_NO_TYPE_MAP);
if (PATTERN_PREFIXES.length > 0 && MAP_PREFIXES.length > 0) {
  const missingInMap = PATTERN_PREFIXES.filter(
    (p) => !MAP_PREFIXES.includes(p),
  );
  const missingInPattern = MAP_PREFIXES.filter(
    (p) => !PATTERN_PREFIXES.includes(p),
  );
  if (missingInMap.length > 0 || missingInPattern.length > 0) {
    throw new Error(
      `[ClubPaymentCallbackDispatchService] 订单号前缀映射不一致: ` +
        `ORDER_NO_PATTERN 包含 ${PATTERN_PREFIXES.join('/')}，` +
        `ORDER_NO_TYPE_MAP 包含 ${MAP_PREFIXES.join('/')}，` +
        `缺失: map中缺 ${missingInMap.join('/')}, pattern中缺 ${missingInPattern.join('/')}`,
    );
  }
}

@Injectable()
export class ClubPaymentCallbackDispatchService {
  constructor(
    private readonly clubRechargePaymentService: ClubRechargePaymentService,
    private readonly clubOrderServicePaymentService: ClubOrderServicePaymentService,
  ) {}

  /**
   * 根据订单号前缀路由到对应的落账服务。
   *
   * 订单号格式：
   *   RC{timestamp}{random} — 充值单
   *   SV{timestamp}{random} — 服务购买单
   */
  dispatchByOrderNo(
    orderNo: string,
    settlementParams: ClubPaymentCallbackSettlementParams,
  ): Promise<ClubPaymentCallbackResult> {
    if (!ORDER_NO_PATTERN.test(orderNo)) {
      throw new BadRequestException(
        `订单号格式异常: ${orderNo}（期望格式 RC/SV + 时间戳 + 随机HEX）`,
      );
    }

    const orderType = this.resolveOrderTypeByOrderNo(orderNo);

    if (orderType === 'recharge') {
      return this.clubRechargePaymentService.confirmOrderPaidByCallback(
        orderNo,
        settlementParams,
      );
    }

    return this.clubOrderServicePaymentService.confirmOrderPaidByCallback(
      orderNo,
      settlementParams,
    );
  }

  private resolveOrderTypeByOrderNo(orderNo: string): 'recharge' | 'service' {
    const prefix = orderNo.slice(0, 2).toUpperCase();
    const orderType = ORDER_NO_TYPE_MAP[prefix];

    if (!orderType) {
      throw new BadRequestException(
        `无法从订单号识别订单类型: ${orderNo}（期望前缀 RC / SV）`,
      );
    }

    return orderType;
  }
}
