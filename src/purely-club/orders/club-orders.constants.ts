export const CLUB_MEMBER_NOT_FOUND_MESSAGE = '当前门店下找不到会员档案';
export const CLUB_PRODUCT_NOT_FOUND_MESSAGE =
  '当前门店下找不到可购买的服务商品';
export const CLUB_SERVICE_CONFIRM_NOT_ALLOWED_MESSAGE =
  '当前订单状态不支持确认支付';

/**
 * @deprecated 积分规则现已动态读取自 marketingMemberLevelSetting.pointsRatio
 * 使用 ClubOrderServiceCreationService.getPointsRatioConfig() 获取当前配置
 */
export const CLUB_POINTS_TO_YUAN_RATE = 1;

/**
 * @deprecated 积分规则现已动态读取自 marketingMemberLevelSetting.pointsRatio
 * 使用 ClubOrderServiceCreationService.getPointsRatioConfig() 获取当前配置
 */
export const CLUB_POINTS_MAX_DEDUCT_RATIO = 0.5;
