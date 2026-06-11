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
    paymentParams: draft.paymentParams,
  };
}
