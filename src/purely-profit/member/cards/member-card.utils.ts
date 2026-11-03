// 会员卡纯函数工具：到期时间与剩余天数换算
//
// 约定：到期时间一律按上海时区「第 validDays 天的 23:59:59.999」计算，
// 禁止用 UTC 直接加天数，避免跨时区出现少一天 / 多一天。
import { getShanghaiDayStartMs } from '../../../shared/shanghai-time.utils';
import { normalizePhone } from '../../marketing/marketing.utils';
import { MEMBER_CARD_DAY_MS } from './member-card.constants';

/** 微信无手机号用户的占位手机号前缀（不是真实号码，禁止下发） */
const CLUB_WECHAT_PHONE_PREFIX = 'club_wechat:';

/**
 * 商家端展示手机号：归一化后返回完整 11 位号码。
 *
 * 商家端（purely-profit）办卡对账、顾客回访都需要完整号码，因此这里不再脱敏；
 * 占位号（club_wechat:xxx）与无法归一化的脏数据返回 undefined，由调用方不下发该字段。
 */
export const resolveDisplayPhone = (
  phone: string | null | undefined,
): string | undefined => {
  if (!phone || phone.startsWith(CLUB_WECHAT_PHONE_PREFIX)) return undefined;
  return normalizePhone(phone) ?? undefined;
};

/**
 * 到期时间：生效日零点 + validDays 天 - 1ms，
 * 即「第 validDays 天的最后一毫秒」（含生效当天为第 1 天）。
 *
 * 必须以生效日的上海零点为基准，不能直接在生效瞬间上叠加天数：
 * 22:00 购买的 30 天卡若按「瞬间 + 30 天 - 1ms」计算，会在第 30 天 21:59:59.999
 * 就失效，而卡包按日展示「有效期至第 30 天」，出现「有效期至今天却已过期」的自相矛盾。
 */
export function resolveCardExpiresAt(
  startsAtMs: number,
  validDays: number,
): Date {
  return new Date(
    getShanghaiDayStartMs(startsAtMs) + validDays * MEMBER_CARD_DAY_MS - 1,
  );
}

/** 剩余天数：不足一天按一天计（仍在有效期内即应显示 1 天）；无到期时间返回 undefined */
export function calcRemainingDays(
  expiresAt: Date | null,
  nowMs: number,
): number | undefined {
  if (expiresAt === null) {
    return undefined;
  }

  const diffMs = expiresAt.getTime() - nowMs;
  if (diffMs <= 0) {
    return 0;
  }

  return Math.ceil(diffMs / MEMBER_CARD_DAY_MS);
}
