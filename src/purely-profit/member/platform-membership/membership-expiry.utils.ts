import { ConflictException } from '@nestjs/common';
import type { MembershipRuntimeLevel } from './membership-capabilities.shared';
import type { PlatformMembershipPlanId } from './dto/platform-membership-query.dto';
import {
  DAY_MS,
  DEFAULT_MEMBERSHIP_PLAN_SETTINGS,
} from './platform-membership.constants';
import type {
  MembershipPlanConfig,
  StoreMembershipProfileRecord,
} from './platform-membership.types';

/** 判定到期时间所需的最小档案字段集 */
export type MembershipExpiryProfile = Pick<
  StoreMembershipProfileRecord,
  'currentPlanId' | 'startsAt' | 'expiresAt'
>;

/** 判定降级态所需字段集：在到期字段之外还需 `previousPlanId` */
export type MembershipDowngradeProfile = MembershipExpiryProfile &
  Partial<Pick<StoreMembershipProfileRecord, 'previousPlanId'>>;

/**
 * 到期时间的来源。
 *
 * 必须区分来源而不是只给一个 `Date | null`：
 * 「永不过期」与「算不出到期时间」都表现为 `null`，但前者要放行、
 * 后者是脏数据要告警，混在一起就会把数据缺失当成永不过期（或反过来
 * 当成已到期），两种误判方向都曾真实发生过。
 */
export type MembershipExpirySource =
  /** 档案显式写入了 `expiresAt`——正常路径 */
  | 'explicit'
  /** `expiresAt` 缺失，按 `startsAt + 套餐时长` 推导 */
  | 'derived'
  /** 永不过期：真永久会员，或历史兼容的 yearly 永久会员 */
  | 'perpetual'
  /** 算不出到期时间（`expiresAt` 与 `startsAt` 都没有）——脏数据 */
  | 'none';

export interface ResolvedMembershipExpiry {
  /** 到期时间；`null` 表示不存在到期时间（永不过期或算不出） */
  expiresAt: Date | null;
  source: MembershipExpirySource;
}

const EMPTY_PROFILE: MembershipExpiryProfile = {
  currentPlanId: null,
  startsAt: null,
  expiresAt: null,
};

/**
 * 历史 AGES 会员的展示有效期（天）。
 *
 * 早年 `lifetime` 枚举还没加，AGES 会员落库为 `yearly + expiresAt=null`，
 * 但产品口径上它就是按 730 天售卖的 AGES 档——与 `yearly` 自己的
 * `validDays=365` **不是一回事**。对外展示的到期窗口必须仍是 730 天，
 * 否则 AGES 商家会看到自己的有效期凭空缩水一半。
 */
const LEGACY_AGES_VALID_DAYS = 730;

/**
 * 套餐的时长天数。
 *
 * 与 `buildPlanExpiryAt` 同一口径：优先 `validDays`（自然年 365），
 * 未配置时退回 `durationMonths × 30`。
 */
export function resolvePlanValidDays(
  planId: PlatformMembershipPlanId | null,
): number | null {
  if (!planId) {
    return null;
  }

  const setting = DEFAULT_MEMBERSHIP_PLAN_SETTINGS[planId];
  if (!setting) {
    return null;
  }

  if (setting.validDays !== null && setting.validDays > 0) {
    return setting.validDays;
  }

  if (setting.durationMonths !== null && setting.durationMonths > 0) {
    return setting.durationMonths * 30;
  }

  return null;
}

/**
 * 是否为「永不过期」档案。
 *
 * 仅 `lifetime` 且未写入 `expiresAt` 一种：这是早年卖出的真永久会员，
 * 名称即语义，不存在到期一说。
 *
 * ⚠️ 历史 AGES（`yearly + expiresAt=null`）**不在此列**：它只是「不设到期
 * 时间」，对外仍要展示 730 天的有效期窗口（见 `LEGACY_AGES_VALID_DAYS`）。
 */
export function isPerpetualMembershipProfile(
  profile: MembershipExpiryProfile | null,
): boolean {
  return profile?.currentPlanId === 'lifetime' && !profile?.expiresAt;
}

/**
 * 历史 AGES：早年 `lifetime` 枚举还没加时用 `yearly + null expiresAt` 表示 AGES 会员。
 *
 * 需同时满足 `startsAt` 存在才认定，防止残缺数据被当成永久会员。
 *
 * 它有两处用途，必须保持一致：
 * 1. 档位识别——档案上不设到期时间，档位恒为 lifetime，不会真正到期；
 * 2. 到期时间推导——对外展示的有效期窗口按 AGES 的 730 天口径，
 *    而不是 `yearly` 自己的 `validDays=365`。
 */
export function isLegacyLifetimeProfile(
  profile: MembershipExpiryProfile | null,
): boolean {
  return (
    profile?.currentPlanId === 'yearly' &&
    profile.expiresAt === null &&
    profile.startsAt !== null
  );
}

/**
 * 会员到期时间的**唯一真相源**。
 *
 * 优先级：`expiresAt` → `startsAt + 套餐时长` → 无到期时间。
 *
 * ⚠️ 绝不能用 `Date.now()` 当推导基准：那样算出的到期时间永远在未来，
 * 等价于「永不过期」，且每次调用结果都不同（不可缓存、不可复现）。
 * 推导必须有 `startsAt` 这一事实锚点，否则就诚实地返回 `none`。
 */
export function resolveMembershipExpiry(
  profile: MembershipExpiryProfile | null,
): ResolvedMembershipExpiry {
  const source = profile ?? EMPTY_PROFILE;

  if (source.expiresAt) {
    return { expiresAt: source.expiresAt, source: 'explicit' };
  }

  if (!source.currentPlanId) {
    return { expiresAt: null, source: 'none' };
  }

  if (isPerpetualMembershipProfile(source)) {
    return { expiresAt: null, source: 'perpetual' };
  }

  // ⚠️ 推导必须有 `startsAt` 这一事实锚点。用 `Date.now()` 当基准会让算出的
  // 到期时间恒在未来，等价于「永不过期」，且每次调用结果都不同（不可缓存、
  // 不可复现）——曾因此让 `yearly + 无 startsAt + 无 expiresAt` 的残缺档案
  // 变成静默的永久会员。推不出来就诚实地返回 `none`。
  if (!source.startsAt) {
    return { expiresAt: null, source: 'none' };
  }

  const validDays = isLegacyLifetimeProfile(source)
    ? LEGACY_AGES_VALID_DAYS
    : resolvePlanValidDays(source.currentPlanId);

  if (validDays === null) {
    return { expiresAt: null, source: 'none' };
  }

  return {
    expiresAt: new Date(source.startsAt.getTime() + validDays * DAY_MS),
    source: 'derived',
  };
}

/**
 * 实时生效档位。
 *
 * 到期时间算不出来（`source === 'none'`，即 `expiresAt` 与 `startsAt` 都没有）
 * 时按 **free** 处理：无法证明会员有效，就不该下发付费档位的能力与配额，
 * 否则一份残缺档案等于白送付费权益。
 *
 * 注意这与 `isMembershipDowngraded` 的方向**刻意相反**——后者对同样的脏数据
 * 按「未降级」处理，不去施加到期限制（见该函数注释）。两者合起来的效果是
 * 「不送权益，但也不掐营业」，并且脏数据会触发 `normalizeMembershipProfileFromPaidOrders`
 * 用已支付订单重建档案这条修复路径。
 */
export function resolveMembershipLevel(
  profile: MembershipExpiryProfile | null,
  nowMs: number = Date.now(),
): MembershipRuntimeLevel {
  if (!profile?.currentPlanId) {
    return 'free';
  }

  // 历史 AGES：档案上不设到期时间，档位恒为 lifetime，不会真正到期。
  // 它对外仍展示 730 天有效期窗口，但那个窗口只用于展示，不参与降级判定。
  if (isLegacyLifetimeProfile(profile)) {
    return 'lifetime';
  }

  const resolved = resolveMembershipExpiry(profile);

  if (resolved.source === 'perpetual') {
    return 'lifetime';
  }

  if (resolved.expiresAt === null) {
    return 'free';
  }

  if (resolved.expiresAt.getTime() <= nowMs) {
    return 'free';
  }

  return profile.currentPlanId;
}

/**
 * 当前是否为有效会员。
 *
 * 直接由 `resolveMembershipLevel` 派生，不再单独实现一份过期判断——
 * 两份口径一旦漂移，就会出现「后端已按过期拦截、前端却不显示续费引导」
 * 这种最难排查的静默降级。
 */
export function isMembershipProfileActive(
  profile: MembershipExpiryProfile | null,
  nowMs: number = Date.now(),
): boolean {
  return resolveMembershipLevel(profile, nowMs) !== 'free';
}

/**
 * 是否为「曾经开通过会员、现已到期」的降级态。
 *
 * ⚠️ 必须区分于「从未开通过」：两者当前档位都是 free，但从未开通的门店
 * 属于免费版正常用户，不能施加到期专属限制，否则会误伤全部免费商家。
 *
 * 「曾开通」要同时看 `previousPlanId`：运营把过期门店设为免费会把
 * `currentPlanId` 清空，此时只剩 `previousPlanId` 能证明它开通过；
 * 漏掉这个字段就等于给了一条「设为免费即解除全部降级限制」的绕过路径。
 */
export function isMembershipDowngraded(
  profile: MembershipDowngradeProfile | null,
  nowMs: number = Date.now(),
): boolean {
  if (!profile?.currentPlanId && !profile?.previousPlanId) {
    return false;
  }

  // 到期时间算不出来时**不**按降级处理：`resolveMembershipLevel` 对这种情况
  // 返回 free（不给付费权益），但「限制营业」是另一回事——拿不到到期时间
  // 就断言「已到期」，会让一次 `expiresAt` 写入失败直接掐断门店营业
  // （C 端停新单、B 端禁追加点单、手动录单限额）。这类脏数据由调用方
  // 按 `source === 'none'` 告警并修数据，而不是靠停营业来暴露。
  if (resolveMembershipExpiry(profile).source === 'none') {
    return false;
  }

  return resolveMembershipLevel(profile, nowMs) === 'free';
}

export function buildPlanExpiryAt(
  plan: Pick<MembershipPlanConfig, 'name' | 'durationMonths' | 'validDays'>,
  baseMs: number,
): Date {
  // 优先按 validDays 精确天数（如年卡 365 自然年）；
  // 未配置 validDays 时退回 durationMonths × 30 的简化口径
  if (plan.validDays !== null && plan.validDays > 0) {
    return new Date(baseMs + plan.validDays * DAY_MS);
  }

  if (plan.durationMonths !== null && plan.durationMonths > 0) {
    return new Date(baseMs + plan.durationMonths * 30 * DAY_MS);
  }

  throw new ConflictException(`${plan.name}套餐配置缺少有效时长`);
}

export function calcRemainingDays(
  profile: MembershipExpiryProfile | null,
  nowMs: number = Date.now(),
): number {
  const expiresAt = resolveMembershipExpiry(profile).expiresAt;
  if (!expiresAt) {
    return 0;
  }

  const diff = expiresAt.getTime() - nowMs;
  return Math.max(0, Math.ceil(diff / DAY_MS));
}
