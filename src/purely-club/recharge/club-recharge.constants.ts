export const CLUB_RECHARGE_PREVIEW_COUNT = 3;
/** 自定义充值金额最小值（元），与 DTO @Min(0.01) 保持一致 */
export const CLUB_CUSTOM_AMOUNT_MIN = 0.01;
/** 自定义充值金额最大值（元），与 DTO @Max(50000) 保持一致 */
export const CLUB_CUSTOM_AMOUNT_MAX = 50000;

export { CLUB_MEMBER_NOT_FOUND_MESSAGE } from '../club-errors.constants';
export const CLUB_RECHARGE_PACKAGE_NOT_FOUND_MESSAGE =
  '当前门店下找不到该充值套餐';
export const CLUB_RECHARGE_CONFIRM_NOT_ALLOWED_MESSAGE =
  '当前订单状态不支持确认支付';
