// 不经过微信收银台的即时落账：零元卡（赠送定价）与余额支付共用
// 两条链路都在建单同一请求内完成发卡，前端据响应 status=paid 直接收尾
import { Injectable } from '@nestjs/common';
import type { MemberCardOrder } from '@prisma/client';
import { ClubCardSettlementService } from './club-card-settlement.service';
import type { ClubCardPaymentMethod } from './club-cards.types';

/** 即时落账结果：只回传卡 ID，订单视图由下单侧重读组装，避免两处各自拼装 */
export interface ClubCardImmediateSettlementResult {
  cardId: number | null;
}

@Injectable()
export class ClubCardImmediateSettlementService {
  constructor(private readonly settlementService: ClubCardSettlementService) {}

  /**
   * 按价格与支付方式决定是否需要立即落账。
   *
   * @returns 已落账的结果；需要用户走微信支付时返回 null
   */
  async settle(
    order: MemberCardOrder,
    priceFen: number,
    paymentMethod: ClubCardPaymentMethod,
  ): Promise<ClubCardImmediateSettlementResult | null> {
    if (priceFen <= 0) {
      // 零元卡无法走微信收款：交易号加 `zero-` 前缀，对账侧可与真实流水区分
      const settlement = await this.settlementService.settlePaidOrder(
        order.id,
        0,
        {
          transactionId: `zero-${order.orderNo}`,
          paidAtMs: Date.now(),
          callbackReceivedAtMs: Date.now(),
        },
      );
      return { cardId: settlement.cardId };
    }

    if (paymentMethod === 'balance') {
      // 余额支付：扣款与发卡在同一事务内完成，响应即最终结果
      const settlement = await this.settlementService.settlePaidOrderByBalance(
        order.id,
      );
      return { cardId: settlement.cardId };
    }

    return null;
  }
}
