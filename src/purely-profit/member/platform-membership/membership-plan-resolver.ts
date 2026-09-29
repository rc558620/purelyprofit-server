import { ConflictException } from '@nestjs/common';
import type { PlatformMembershipPlanId } from './dto/platform-membership-query.dto';
import { createHash } from 'node:crypto';
import {
  DEFAULT_MEMBERSHIP_PLAN_SETTINGS,
  PLAN_LEVEL_RANK,
  PLAN_RECOMMEND_CONFIG,
  PLATFORM_MEMBERSHIP_PLAN_ORDER,
} from './platform-membership.constants';
import {
  buildPlanExpiryAt,
  isMembershipProfileActive,
  resolveFrontendMembershipExpiry,
} from './membership-expiry.utils';
import type {
  MembershipPlanConfig,
  MembershipPlanSettingRecord,
  StoreMembershipOrderRecord,
  StoreMembershipProfileRecord,
} from './platform-membership.types';

export function normalizeMembershipProfileFromPaidOrders(params: {
  profile: StoreMembershipProfileRecord;
  paidOrders: Pick<StoreMembershipOrderRecord, 'planId' | 'createdAt'>[];
  plans: Pick<
    MembershipPlanConfig,
    'id' | 'name' | 'durationMonths' | 'validDays'
  >[];
  nowMs?: number;
}): StoreMembershipProfileRecord {
  const { profile, paidOrders, plans, nowMs = Date.now() } = params;

  if (isMembershipProfileActive(profile, nowMs) || paidOrders.length === 0) {
    return profile;
  }

  // startsAt 非空表示档案已被显式写入（管理员设置会员等级 / 购买流程落盘），
  // 即使当前为免费（管理员降级）也不得用历史付费订单重建，否则降级会被回滚
  if (profile.startsAt !== null) {
    return profile;
  }

  const rebuiltSnapshot = rebuildMembershipProfileFromPaidOrders({
    paidOrders,
    plans,
  });
  if (!rebuiltSnapshot || !isMembershipProfileActive(rebuiltSnapshot, nowMs)) {
    return profile;
  }

  return {
    ...profile,
    ...rebuiltSnapshot,
  };
}

/**
 * 角标文案的**唯一实现**：由「划线原价 − 实付价」算出，不允许写死。
 *
 * 运营每次调划线价或实付价后，`省X元` 都必须跟着变，否则卡片上会出现
 * 「划线 ¥998 / 实付 ¥369 / 省15元」这种自相矛盾的展示。
 *
 * - 无划线价（永久会员）或划线价不高于实付价时返回 undefined，由 UI 只渲染赠分角标；
 * - 差额非整元时保留两位小数（分口径不丢精度）。
 */
export function resolvePlanBadge(
  price: number,
  originalPrice: number | null | undefined,
): string | undefined {
  if (typeof originalPrice !== 'number' || !Number.isFinite(originalPrice)) {
    return undefined;
  }

  const savedFen = originalPrice - price;
  if (savedFen <= 0) {
    return undefined;
  }

  const savedYuan = savedFen / 100;

  return `省${Number.isInteger(savedYuan) ? savedYuan : savedYuan.toFixed(2)}元`;
}

/**
 * 套餐列表「代码级展示口径」签名：所有**不下库**、只由代码决定的展示配置。
 *
 * 主推位（`PLAN_RECOMMEND_CONFIG`）、档位顺序、默认套餐配置改了都不会动任何
 * `updatedAt`，只由数据时间戳算出的 pricing-version 永远发现不了变化 —— 部署后
 * 商家端在同一次会话里会一直命中本地缓存，继续看到旧的主推位。
 *
 * 刻意**不含** `PLAN_RULES`：对比表是前端静态数据，商家端不消费 `/rules`，
 * 纳入只会带来无意义的缓存失效。
 *
 * 角标规则（`resolvePlanBadge`）本身是函数，直接哈希它没有意义，改为把默认配置
 * 喂进去、用**输出**反推规则变化：规则一改，同样输入算出的文案就会变。
 */
export function buildPlanPresentationSignature() {
  return {
    recommended: PLAN_RECOMMEND_CONFIG,
    order: PLATFORM_MEMBERSHIP_PLAN_ORDER,
    defaults: DEFAULT_MEMBERSHIP_PLAN_SETTINGS,
    badges: Object.values(DEFAULT_MEMBERSHIP_PLAN_SETTINGS).map((setting) =>
      resolvePlanBadge(setting.price, setting.originalPrice ?? setting.price),
    ),
  };
}

/**
 * 把签名折成版本号整数（取哈希前 6 位十六进制，≤ 0xFFFFFF）。
 *
 * 叠加在数据时间戳上时不会盖过时间戳的量级（最多相当于约 4.6 小时的毫秒数，
 * 不影响排障时当时间看），又足以让「改了代码但没改数据」拿到不同的版本号。
 */
export function computePresentationVersion(signature: unknown): number {
  const digest = createHash('sha256')
    .update(JSON.stringify(signature))
    .digest('hex');

  return Number.parseInt(digest.slice(0, 6), 16);
}

/**
 * 当前代码的套餐展示口径版本号：由签名算出，**改了配置就自动变**，
 * 不需要人工维护计数器（人工 +1 一旦漏改，缓存就刷新不掉）。
 */
export const MEMBERSHIP_PLAN_PRESENTATION_VERSION: number =
  computePresentationVersion(buildPlanPresentationSignature());

export function toPlanConfig(
  setting: MembershipPlanSettingRecord,
): MembershipPlanConfig {
  const planId = setting.planId as PlatformMembershipPlanId;
  const recommendConfig = PLAN_RECOMMEND_CONFIG[planId];

  if (setting.durationMonths !== null && setting.durationMonths > 0) {
    // 无划线价配置时回落到实付价，此时差额为 0、不产生角标
    const originalPrice = setting.originalPrice ?? setting.price;
    const badge = resolvePlanBadge(setting.price, originalPrice);

    return {
      id: planId,
      name: setting.planName,
      price: setting.price,
      originalPrice,
      durationMonths: setting.durationMonths,
      validDays: setting.validDays,
      monthlyPrice: Math.floor(setting.price / setting.durationMonths),
      ...recommendConfig,
      ...(badge ? { badge } : {}),
    };
  }

  if (setting.validDays !== null && setting.validDays > 0) {
    const badge = resolvePlanBadge(setting.price, setting.originalPrice);

    return {
      id: planId,
      name: setting.planName,
      price: setting.price,
      originalPrice: setting.originalPrice,
      durationMonths: setting.durationMonths,
      validDays: setting.validDays,
      ...recommendConfig,
      ...(badge ? { badge } : {}),
    };
  }

  throw new ConflictException(`${setting.planName}套餐配置缺少有效时长`);
}

export function resolveEffectivePlanId(
  currentPlanId: PlatformMembershipPlanId | null,
  purchasedPlanId: PlatformMembershipPlanId,
): PlatformMembershipPlanId {
  if (!currentPlanId) {
    return purchasedPlanId;
  }

  return PLAN_LEVEL_RANK[purchasedPlanId] > PLAN_LEVEL_RANK[currentPlanId]
    ? purchasedPlanId
    : currentPlanId;
}

function rebuildMembershipProfileFromPaidOrders(params: {
  paidOrders: Pick<StoreMembershipOrderRecord, 'planId' | 'createdAt'>[];
  plans: Pick<
    MembershipPlanConfig,
    'id' | 'name' | 'durationMonths' | 'validDays'
  >[];
}): Pick<
  StoreMembershipProfileRecord,
  'currentPlanId' | 'startsAt' | 'expiresAt'
> | null {
  const { paidOrders, plans } = params;
  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const orderedPaidOrders = [...paidOrders].sort(
    (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
  );

  let snapshot: Pick<
    StoreMembershipProfileRecord,
    'currentPlanId' | 'startsAt' | 'expiresAt'
  > = {
    currentPlanId: null,
    startsAt: null,
    expiresAt: null,
  };

  for (const order of orderedPaidOrders) {
    const plan = planById.get(order.planId);
    if (!plan) {
      continue;
    }

    const orderTime = order.createdAt.getTime();
    const currentExpiryMs =
      resolveFrontendMembershipExpiry(snapshot)?.getTime() ?? 0;
    const baseMs = currentExpiryMs > orderTime ? currentExpiryMs : orderTime;
    const currentActivePlanId =
      currentExpiryMs > orderTime ? snapshot.currentPlanId : null;

    snapshot = {
      currentPlanId: resolveEffectivePlanId(currentActivePlanId, order.planId),
      startsAt: snapshot.startsAt ?? order.createdAt,
      expiresAt: buildPlanExpiryAt(plan, baseMs),
    };
  }

  return snapshot.currentPlanId ? snapshot : null;
}
