import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import {
  MANUAL_ENTRY_DAILY_LIMIT,
  MAX_ACTIVE_SPACE_SESSIONS,
} from './membership-downgrade.constants';
import {
  ADDITIONAL_BLOCKED_MESSAGE,
  buildMembershipExpiredException,
  MANUAL_ENTRY_QUOTA_MESSAGE,
  SPACE_OPEN_BLOCKED_MESSAGE,
} from './membership-downgrade.messages';
import {
  countActiveSpaceSessions,
  loadDowngradeProfile,
  MembershipClockDriftProbe,
} from './membership-downgrade.query';
import {
  incrementManualEntryCount,
  readDowngradeStateCache,
  readManualEntryCount,
  writeDowngradeStateCache,
} from './membership-downgrade.store';
import {
  calcRemainingDays,
  isDowngradeExpiringSoon,
} from './membership-downgrade.shared';
import type {
  ManualEntryUsage,
  StoreDowngradeState,
} from './membership-downgrade.types';
import {
  isMembershipDowngraded,
  resolveMembershipExpiry,
  resolveMembershipLevel,
} from './platform-membership-access.shared';

/**
 * 会员降级态服务。
 *
 * 只承载「曾经开通过会员、现已过期」才生效的限制，供 B 端（purely-profit）
 * 与 C 端（purely-club）共用同一份判定，避免两端各算一套：
 *
 * 1. **C 端停新单**：过期门店顾客无法发起新下单，在途订单放行；
 * 2. **B 端追加点单禁用**：过期门店不能追加记账（餐饮 / 非餐饮均禁）；
 * 3. **B 端空间同时开台数 ≤ 1**；
 * 4. **B 端手动录单每日 ≤ 5 单**（餐饮到期账号的营业兜底通道）。
 *
 * 注意：免费版既有规则（商品/空间/员工新增配额、财务营销关闭、历史 7 天）
 * 不受此处影响，由 PlatformMembershipAccessService 单独负责。
 *
 * 判定所需的存储读写分别落在 `membership-downgrade.query.ts`（DB）与
 * `membership-downgrade.store.ts`（Redis），本文件只做编排。
 */
@Injectable()
export class MembershipDowngradeService {
  private readonly logger = new Logger(MembershipDowngradeService.name);

  private readonly clockDriftProbe: MembershipClockDriftProbe;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {
    this.clockDriftProbe = new MembershipClockDriftProbe(prisma);
  }

  /**
   * 查询门店降级态。
   *
   * 结果按门店缓存：扫码点餐的每次加购都会走这里（assertStoreCanOrder），
   * 加购是高频操作，若不缓存会让每笔加购多一次 DB 查询。
   * 续费下单时会按 pattern 主动失效，保证「续费后立即恢复」。
   */
  async getDowngradeState(storeId: number): Promise<StoreDowngradeState> {
    const cached = await readDowngradeStateCache(
      this.redisService,
      this.logger,
      storeId,
    );
    if (cached) {
      return cached;
    }

    await this.clockDriftProbe.probe(this.logger);

    const profile = await loadDowngradeProfile(this.prisma, storeId);
    const level = resolveMembershipLevel(profile);
    // 与 level 同源：直接取 `expiresAt` 会在「expiresAt 缺失但按 startsAt 推导出
    // 到期时间」时给出 null，导致在途订单放行判断失效
    const resolvedExpiry = resolveMembershipExpiry(profile);
    const expiredAt = resolvedExpiry.expiresAt?.getTime() ?? null;

    // 到期时间算不出来时：档位按 free（不送付费权益），但 isMembershipDowngraded
    // 返回 false（不施加到期限制），所以这里只告警、不停营业。
    // 这类脏数据必须由监控发现并修数据，而不是靠停掉门店营业来暴露
    if (resolvedExpiry.source === 'none' && profile?.currentPlanId) {
      this.logger.warn(
        `会员档案缺少可判定的到期时间，本次按未过期处理：storeId=${storeId}, ` +
          `currentPlanId=${profile.currentPlanId}, startsAt=${profile.startsAt?.toISOString() ?? 'null'}`,
      );
    }

    const state: StoreDowngradeState = {
      // 从未开通过（无任何套餐记录）不算降级，保持免费版原有权益
      isExpired: isMembershipDowngraded(profile),
      level,
      expiredAt,
      remainingDays: calcRemainingDays(expiredAt),
    };

    await writeDowngradeStateCache(
      this.redisService,
      this.logger,
      storeId,
      state,
    );
    return state;
  }

  /** 是否处于续费提醒窗口（到期前 N 天，含当天） */
  isExpiringSoon(state: StoreDowngradeState): boolean {
    return isDowngradeExpiringSoon(state);
  }

  // ─── C 端：停新单 ────────────────────────────────────────────────────

  /**
   * C 端新下单门禁：过期门店拒绝发起**新的**下单流程。
   *
   * 只拦「发起」动作（首次加购、创建订单）。已存在的购物车 / 会话若在到期之前
   * 就已开始，则允许继续走完——顾客可能已经选完菜甚至付了钱，绝不能卡在半路。
   * 已存在订单的支付、核销、退款不经过这里，天然放行。
   *
   * @param startedAt 当前下单流程的开始时间（购物车 / 会话创建时间）。
   *                  早于到期时刻视为「在途」，放行；为空则视为新流程。
   */
  async assertStoreCanOrder(
    storeId: number,
    message: string,
    startedAt: Date | null = null,
  ): Promise<void> {
    const state = await this.getDowngradeState(storeId);
    if (!state.isExpired) {
      return;
    }

    if (startedAt !== null && state.expiredAt !== null) {
      if (startedAt.getTime() <= state.expiredAt) {
        return;
      }
    }

    throw buildMembershipExpiredException(message);
  }

  // ─── B 端：追加点单禁用 ──────────────────────────────────────────────

  /**
   * 追加点单「确认并记账」门禁。
   *
   * 仅对过期账号生效——从未开通的免费账号照常可用，因为免费版本就包含该能力，
   * 到期属于「曾经付费后失去」，两者性质不同。
   */
  async assertAdditionalEnabled(storeId: number): Promise<void> {
    const state = await this.getDowngradeState(storeId);
    if (state.isExpired) {
      throw buildMembershipExpiredException(ADDITIONAL_BLOCKED_MESSAGE);
    }
  }

  // ─── B 端：空间同时开台数 ────────────────────────────────────────────

  /**
   * 空间开台 / 预定门禁：过期账号同时只能有 1 个进行中的会话。
   *
   * 与免费版既有的「空间总条数上限」（spaceLimit）是两个维度：
   * 后者限制能建几个台位，这里限制同时能开几个台。
   */
  async assertSpaceCanOpen(storeId: number): Promise<void> {
    const state = await this.getDowngradeState(storeId);
    if (!state.isExpired) {
      return;
    }

    const activeSessions = await countActiveSpaceSessions(this.prisma, storeId);

    if (activeSessions >= MAX_ACTIVE_SPACE_SESSIONS) {
      throw buildMembershipExpiredException(SPACE_OPEN_BLOCKED_MESSAGE);
    }
  }

  // ─── B 端：手动录单每日限额 ──────────────────────────────────────────

  /**
   * 手动录单门禁：过期账号每日最多录 N 单。
   *
   * 这是 C 端停新单后的营业兜底通道——不让商家完全做不了生意，
   * 但限制规模，形成续费驱动力。未过期账号不受限。
   *
   * @returns 今日已录单数（供调用方展示剩余额度）
   */
  async assertManualEntryQuota(storeId: number): Promise<number> {
    const state = await this.getDowngradeState(storeId);
    if (!state.isExpired) {
      return 0;
    }

    const used = await readManualEntryCount(
      this.redisService,
      this.logger,
      storeId,
    );
    if (used >= MANUAL_ENTRY_DAILY_LIMIT) {
      throw buildMembershipExpiredException(MANUAL_ENTRY_QUOTA_MESSAGE);
    }

    return used;
  }

  /** 手动录单成功后累加当日计数（仅过期账号需要） */
  async incrementManualEntryCount(storeId: number): Promise<void> {
    const state = await this.getDowngradeState(storeId);
    if (!state.isExpired) {
      return;
    }

    await incrementManualEntryCount(this.redisService, storeId);
  }

  /** 查询今日已手动录单数（未过期恒为 0） */
  async getManualEntryUsage(storeId: number): Promise<ManualEntryUsage> {
    const state = await this.getDowngradeState(storeId);
    if (!state.isExpired) {
      return { used: 0, limit: MANUAL_ENTRY_DAILY_LIMIT };
    }

    return {
      used: await readManualEntryCount(this.redisService, this.logger, storeId),
      limit: MANUAL_ENTRY_DAILY_LIMIT,
    };
  }
}
