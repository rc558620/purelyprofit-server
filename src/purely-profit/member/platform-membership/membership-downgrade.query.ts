import type { Logger } from '@nestjs/common';
import type { PrismaService } from '../../../prisma/prisma.service';
import {
  CLOCK_DRIFT_PROBE_INTERVAL_MS,
  CLOCK_DRIFT_WARN_THRESHOLD_MS,
} from './membership-downgrade.constants';
import { loadDbNowMs } from './platform-membership.query';
import type { StoreMembershipProfileSnapshot } from './platform-membership-access.shared';

/**
 * 降级态判定的数据库读取。
 *
 * 集中在这里是为了让「查哪些列」只有一处实现：漏掉 `previousPlanId` 会让
 * 「运营把过期门店设为免费」变成解除全部到期限制的绕过路径。
 */

/**
 * 降级态判定所需的档案字段。
 *
 * `previousPlanId` 不能省：运营把过期门店设为免费会清空 `currentPlanId`，
 * 此时只剩它证明该门店「曾开通过」。漏掉就会让「设为免费」变成
 * 解除全部到期限制的绕过路径。
 */
const PROFILE_SELECT = {
  currentPlanId: true,
  previousPlanId: true,
  startsAt: true,
  expiresAt: true,
} as const;

/**
 * 读取降级态判定所需的会员档案。
 *
 * 门店 id 非法时返回 null（按「从未开通」处理）：这类入参来自路径参数，
 * 不该让判定抛异常把整个请求打挂。
 */
export async function loadDowngradeProfile(
  prisma: PrismaService,
  storeId: number,
): Promise<StoreMembershipProfileSnapshot | null> {
  const normalizedStoreId = Number(storeId);
  if (!Number.isInteger(normalizedStoreId) || normalizedStoreId <= 0) {
    return null;
  }

  return prisma.storeMembershipProfile.findUnique({
    where: { storeId: normalizedStoreId },
    select: PROFILE_SELECT,
  });
}

/** 门店当前进行中的空间会话数（到期账号的「同时开台数」判据） */
export async function countActiveSpaceSessions(
  prisma: PrismaService,
  storeId: number,
): Promise<number> {
  return prisma.spaceSession.count({
    where: { storeId, status: 'active' },
  });
}

/**
 * 「DB 时钟 − 应用时钟」漂移探测。
 *
 * 为什么值得测：会员到期判定目前用应用时钟（`Date.now()`），而到期时间可能由
 * DB 时钟写入的字段推导（订单 `createdAt` 走 Prisma `@default(now())`）。
 * 两者有偏差时，判定就是在跨时钟源比较——DB 慢于应用会把到期时间算早，
 * 门店被提前判为过期。
 *
 * 当前是单机 cluster 部署（同机进程共享系统时钟，进程间漂移恒为 0），
 * 所以这只在「应用机与 DB 机时钟不一致」或将来多机部署时才可能报出来。
 * 先把它变成可观测事实，再决定是否值得为统一时间源付出全链路改造的代价。
 *
 * 探测失败只告警，绝不影响本次判定。
 */
export class MembershipClockDriftProbe {
  /** 上次探测时刻（进程内节流） */
  private lastProbeAtMs = 0;

  constructor(private readonly prisma: PrismaService) {}

  async probe(logger: Logger): Promise<void> {
    const localMs = Date.now();
    if (localMs - this.lastProbeAtMs < CLOCK_DRIFT_PROBE_INTERVAL_MS) {
      return;
    }
    // 先置时间戳，避免探测期间并发请求重复进入（探测本身慢，间隔要按进入时算）
    this.lastProbeAtMs = localMs;

    const dbNowMs = await loadDbNowMs(this.prisma);
    if (dbNowMs === null) {
      return;
    }

    const driftMs = dbNowMs - localMs;
    if (Math.abs(driftMs) < CLOCK_DRIFT_WARN_THRESHOLD_MS) {
      return;
    }

    logger.warn(
      `会员到期判定的时钟源偏差超过 ${CLOCK_DRIFT_WARN_THRESHOLD_MS}ms：` +
        `db=${dbNowMs}, app=${localMs}, drift=${driftMs}ms。` +
        `判定与到期时间推导需统一到同一时钟源，否则同一门店可能在不同实例上判出不同结果。`,
    );
  }
}
