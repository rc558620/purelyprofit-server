import { ForbiddenException } from '@nestjs/common';

// ─── 降级态对外文案（面向顾客与商家，均不暴露"欠费"语义）──────────────

/** 餐饮门店扫码点餐被拦截时的提示 */
export const SCAN_ORDER_BLOCKED_MESSAGE =
  '该门店暂时无法在线点单，请到前台点餐';
/** 非餐饮门店自助下单被拦截时的提示 */
export const SELF_ORDER_BLOCKED_MESSAGE = '该门店暂时无法自助下单，请联系商家';
/** 会员专区（营销商品购买）被拦截时的提示 */
export const MEMBER_ZONE_ORDER_BLOCKED_MESSAGE =
  '会员服务暂时不可用，请联系商家';
/** B 端追加点单「确认并记账」被拦截时的提示（餐饮 + 非餐饮到期账号） */
export const ADDITIONAL_BLOCKED_MESSAGE =
  '会员已到期，追加点单需续费后使用。已录入的商品和历史订单完整保留，不会删除。';
/** 空间开台/预定超出「同时开台数」上限时的提示 */
export const SPACE_OPEN_BLOCKED_MESSAGE =
  '当前会员最多同时开 1 个台，请先结账或关闭现有台位，续费后可同时开多个台。';
/** 手动录单超出每日上限时的提示 */
export const MANUAL_ENTRY_QUOTA_MESSAGE =
  '今日手动录单已达上限，会员到期后每日最多手动录入 5 单，续费后不受限制。';

/**
 * 会员过期错误的业务码。
 *
 * C 端需要据此把「门店不能下单」与普通错误区分开：前者要展示引导弹窗
 * （告知顾客可到前台点餐），后者走常规 toast。仅靠 HTTP 403 无法区分。
 *
 * ⚠️ 修改此处必须同步两个前端（purelyProfit / purelyClub 的
 * src/utils/http/membershipExpired.ts），否则引导弹窗会静默退化成普通报错。
 * 一致性由 scripts/check-membership-contract.mjs 守护。
 */
export const MEMBERSHIP_EXPIRED_ERROR_CODE = 'MEMBERSHIP_EXPIRED';

/**
 * 构造会员过期异常。
 *
 * 带 `code` 字段供 C 端识别：这类错误不是「操作失败」，而是门店状态导致的
 * 不可用，需要展示引导（到前台点餐 / 联系商家），而非一闪而过的错误提示。
 */
export const buildMembershipExpiredException = (
  message: string,
): ForbiddenException =>
  new ForbiddenException({
    statusCode: 403,
    message,
    code: MEMBERSHIP_EXPIRED_ERROR_CODE,
  });
