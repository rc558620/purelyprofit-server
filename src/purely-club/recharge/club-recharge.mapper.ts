import type {
  ClubOrderDraftPayload,
  ClubRechargeOrderMetadata,
} from '../orders/club-order-drafts.types';
import type { ClubOrderStatusResponseDto } from '../orders/dto/club-order.dto';
import type { ClubRechargeOrderResponseDto } from './dto/club-recharge.dto';
import { convertFenToYuan } from './club-recharge.utils';

export function toClubRechargeOrderResponse(
  base: ClubOrderStatusResponseDto,
  draft: ClubOrderDraftPayload<ClubRechargeOrderMetadata, 'recharge'>,
): ClubRechargeOrderResponseDto {
  return {
    ...base,
    rechargeAmount: convertFenToYuan(draft.metadata.rechargeAmountFen),
    bonusAmount: convertFenToYuan(draft.metadata.bonusAmountFen),
    packageId: draft.metadata.packageId,
    // 仅待支付状态透传支付参数；已支付/已关闭等状态返回 null，避免前端误用过期签名
    paymentParams: draft.status === 'pending' ? draft.paymentParams : null!,
  };
}
