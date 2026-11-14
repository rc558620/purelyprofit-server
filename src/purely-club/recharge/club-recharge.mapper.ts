import type {
  ClubOrderDraftPayload,
  ClubRechargeOrderMetadata,
} from '../orders/club-order-drafts.types';
import type { ClubOrderStatusResponseDto } from '../orders/dto/club-order.dto';
import type { ClubRechargeOrderResponseDto } from './dto/club-recharge.dto';
import { Money } from './club-recharge.utils';

export function toClubRechargeOrderResponse(
  base: ClubOrderStatusResponseDto,
  draft: ClubOrderDraftPayload<ClubRechargeOrderMetadata, 'recharge'>,
): ClubRechargeOrderResponseDto {
  return {
    ...base,
    // 后端权威金额口径：直接取落库分值，不做「分→元→分」往返换算，
    // 与团购券的 refundAmountFen 等字段统一为「分」。
    rechargeAmountFen: draft.metadata.rechargeAmountFen,
    bonusAmountFen: draft.metadata.bonusAmountFen,
    // 兼容字段（元）：保留给尚未切换的 purelyClub 版本，避免前端静默取空。
    rechargeAmount: Money.fromDbCents(
      draft.metadata.rechargeAmountFen,
    ).toOutputYuan(),
    bonusAmount: Money.fromDbCents(
      draft.metadata.bonusAmountFen,
    ).toOutputYuan(),
    packageId: draft.metadata.packageId,
    // 仅待支付状态透传支付参数；已支付/已关闭等状态返回 null，避免前端误用过期签名
    paymentParams: draft.status === 'pending' ? draft.paymentParams : null!,
  };
}
