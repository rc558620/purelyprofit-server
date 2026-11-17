import type { PurchaseMembershipResultDto } from './dto/platform-membership-response.dto';
import type { PurchaseMembershipResult } from './platform-membership-order.service';

/**
 * 购买结果 → 响应体。
 *
 * 真实模式只回支付信息（权益等回调生效）；qrCodeImageUrl 必须透传：
 * weixin:// 协议串无法直接作为 <img> 源，前端只认这个字段。
 */
export const mapPurchaseMembershipResult = (
  result: PurchaseMembershipResult,
): PurchaseMembershipResultDto => {
  if (result.mode === 'live') {
    return {
      mode: 'live',
      orderNo: result.orderNo,
      codeUrl: result.codeUrl,
      qrCodeImageUrl: result.qrCodeImageUrl,
      amountFen: result.amountFen,
      expiresAt: result.expiresAt.toISOString(),
    };
  }

  return {
    mode: 'test',
    order: result.order,
    profile: result.profile,
    overview: result.overview,
  };
};
