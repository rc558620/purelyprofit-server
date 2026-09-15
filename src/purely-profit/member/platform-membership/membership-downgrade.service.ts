import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { getShanghaiDayStartMs } from '../../../shared/shanghai-time.utils';
import type { MembershipRuntimeLevel } from './platform-membership-access.shared';
import {
  resolveMembershipLevel,
  type StoreMembershipProfileSnapshot,
} from './platform-membership-access.shared';

// ─── 降级态对外文案（面向顾客与商家，均不暴露"欠费"语义）──────────────

/** 餐饮门店扫码点餐被拦截时的提示 */
export const SCAN_ORDER_BLOCKED_MESSAGE = '该门店暂时无法在线点单，请到前台点餐';
/** 非餐饮门店自助下单被拦截时的提示 */
export const SELF_ORDER_BLOCKED_MESSAGE = '该门店暂时无法自助下单，请联系商家';
/** 会员专区（营销商品购买）被拦截时的提示 */
export const MEMBER_ZONE_ORDER_BLOCKED_MESSAGE = '会员服务暂时不可用，请联系商家';
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

/** 距到期多少天开始展示续费横幅 */
export const MEMBERSHIP_EXPIRING_SOON_DAYS = 10;
/** 到期账号每日手动录单上限 */
export const MANUAL_ENTRY_DAILY_LIMIT = 5;
/** 到期账号同时可开台数上限 */
export const MAX_ACTIVE_SPACE_SESSIONS = 1;

/** 每日手动录单计数的 Redis key 前缀 */
const MANUAL_ENTRY_QUOTA_KEY_PREFIX = 'membership:manual-entry-quota:';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 构造会员过期异常。
 *
 * 带 `code` 字段供 C 端识别：这类错误不是「操作失败」，而是门店状态导致的
 * 不可用，需要展示引导（到前台点餐 / 联系商家），而非一闪而过的错误提示。
 */
const buildMembershipExpiredException = (message: string): ForbiddenException =>
  new ForbiddenException({
    statusCode: 403,
    message,
    code: MEMBERSHIP_EXPIRED_ERROR_CODE,
  });

export interface StoreDowngradeState {
  /**
   * 是否为「曾经开通过会员、现已过期」的降级态。
   *
   * ⚠️ 必须区分于「从未开通过」：两者当前档位都是 free，但从未开通的门店
   * 属于免费版正常用户，不能施加到期专属限制（C 端停新单、追加点单禁用、
   * 手动录单限额），否则会误伤全部免费商家。
   */
  isExpired: boolean;
  /** 当前生效档位 */
  level: MembershipRuntimeLevel;
  /** 到期时间戳（ms），从未开通时为 null */
  expiredAt: number | null;
  /** 剩余天数，从未开通时为 0 */
  remainingDays: number;
}

const PROFILE_SELECT = {
  currentPlanId: true,
  startsAt: true,
  expiresAt: true,
} as const;

/**
 * 降级态缓存 key。
 *
 * 必须遵循 `profit:platform-membership:*:store:{storeId}` 这一格式 ——
 * 续费下单时会调用 invalidatePlatformMembershipDerived 按该 pattern 批量删除，
 * 从而让「续费后立即恢复」生效。若另起一套 key 前缀，续费后仍会读到旧的过期态。
 */
const buildDowngradeStateCacheKey = (storeId: number): string =>
  `profit:platform-membership:downgrade-state:store:${storeId}`;

/**
 * 降级态缓存时长（秒）。
 *
 * 仅作为兜底：正常路径下续费会主动失效缓存。
 * 取 60 秒是为了让缓存内的 remainingDays 不会明显失真（以天为单位的展示）。
 */
const DOWNGRADE_STATE_CACHE_TTL_SECONDS = 60;

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
 */
@Injectable()
export class MembershipDowngradeService {
  private readonly logger = new Logger(MembershipDowngradeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * 查询门店降级态。
   *
   * 结果按门店缓存：扫码点餐的每次加购都会走这里（assertStoreCanOrder），
   * 加购是高频操作，若不缓存会让每笔加购多一次 DB 查询。
   * 续费下单时会按 pattern 主动失效，保证「续费后立即恢复」。
   */
  async getDowngradeState(storeId: number): Promise<StoreDowngradeState> {
    const cacheKey = buildDowngradeStateCacheKey(storeId);

    const cached = await this.readDowngradeStateCache(cacheKey);
    if (cached) {
      return cached;
    }

    const profile = await this.loadProfile(storeId);
    const level = resolveMembershipLevel(profile);
    const expiredAt = profile?.expiresAt?.getTime() ?? null;

    const state: StoreDowngradeState = {
      // 从未开通过（无任何套餐记录）不算降级，保持免费版原有权益
      isExpired: level === 'free' && profile?.currentPlanId != null,
      level,
      expiredAt,
      remainingDays: this.calcRemainingDays(expiredAt),
    };

    await this.writeDowngradeStateCache(cacheKey, state);
    return state;
  }

  /** 是否处于续费提醒窗口（到期前 N 天，含当天） */
  isExpiringSoon(state: StoreDowngradeState): boolean {
    if (state.isExpired || state.expiredAt === null) {
      return false;
    }

    return state.remainingDays <= MEMBERSHIP_EXPIRING_SOON_DAYS;
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

    const activeSessions = await this.prisma.spaceSession.count({
      where: { storeId, status: 'active' },
    });

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

    const used = await this.readManualEntryCount(storeId);
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

    // 必须用 Redis INCR 原子递增。
    // 若改回「先 get 再 set」：并发录单时两个请求可能同时读到 3、各自写 4，
    // 结果是实际录了 5 单而计数只有 4 —— 配额被悄悄突破且难以察觉。
    await this.redisService.incr(
      this.buildManualEntryKey(storeId),
      this.ttlUntilNextDay(),
    );
  }

  /** 查询今日已手动录单数（未过期恒为 0） */
  async getManualEntryUsage(storeId: number): Promise<{ used: number; limit: number }> {
    const state = await this.getDowngradeState(storeId);
    if (!state.isExpired) {
      return { used: 0, limit: MANUAL_ENTRY_DAILY_LIMIT };
    }

    return { used: await this.readManualEntryCount(storeId), limit: MANUAL_ENTRY_DAILY_LIMIT };
  }

  // ─── 内部工具 ────────────────────────────────────────────────────────

  /**
   * 读取降级态缓存。
   *
   * 缓存不可用（Redis 故障 / 脏数据）时返回 null 走回源，绝不因缓存问题
   * 影响下单判定。
   */
  private async readDowngradeStateCache(
    cacheKey: string,
  ): Promise<StoreDowngradeState | null> {
    try {
      const raw = await this.redisService.getJson<StoreDowngradeState>(cacheKey);
      if (!raw || typeof raw !== 'object') {
        return null;
      }

      // 逐字段校验，避免半截数据被当成有效状态
      if (
        typeof raw.isExpired !== 'boolean'
        || typeof raw.level !== 'string'
        || typeof raw.remainingDays !== 'number'
        || (raw.expiredAt !== null && typeof raw.expiredAt !== 'number')
      ) {
        return null;
      }

      return raw;
    } catch (error) {
      this.logger.warn(
        `读取会员降级态缓存失败，改为回源：key=${cacheKey}, `
          + `error=${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /** 写入降级态缓存；失败仅告警，不影响调用方 */
  private async writeDowngradeStateCache(
    cacheKey: string,
    state: StoreDowngradeState,
  ): Promise<void> {
    try {
      await this.redisService.setJson(
        cacheKey,
        state,
        DOWNGRADE_STATE_CACHE_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.warn(
        `写入会员降级态缓存失败（不影响本次判定）：key=${cacheKey}, `
          + `error=${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async readManualEntryCount(storeId: number): Promise<number> {
    try {
      const raw = await this.redisService.getJson<number>(
        this.buildManualEntryKey(storeId),
      );
      return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
    } catch (error) {
      // Redis 不可用时按 0 处理（即放行）：每日限额是可事后追补的商业控制，
      // 不应因为计数组件故障就阻断商家录单这种直接影响营业的操作。
      // 仅告警，由监控发现后跟进。
      this.logger.warn(
        `读取手动录单计数失败，本次按未超限处理：storeId=${storeId}, `
          + `error=${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    }
  }

  /** 计数按上海时区自然日分片，次日 0 点自动失效 */
  private buildManualEntryKey(storeId: number): string {
    const dayStart = getShanghaiDayStartMs(Date.now());
    return `${MANUAL_ENTRY_QUOTA_KEY_PREFIX}${storeId}:${dayStart}`;
  }

  private ttlUntilNextDay(): number {
    const nextDayStart = getShanghaiDayStartMs(Date.now()) + DAY_MS;
    return Math.max(1, Math.ceil((nextDayStart - Date.now()) / 1000));
  }

  private calcRemainingDays(expiredAt: number | null): number {
    if (expiredAt === null) {
      return 0;
    }

    return Math.max(0, Math.ceil((expiredAt - Date.now()) / DAY_MS));
  }

  private async loadProfile(
    storeId: number,
  ): Promise<StoreMembershipProfileSnapshot | null> {
    const normalizedStoreId = Number(storeId);
    if (!Number.isInteger(normalizedStoreId) || normalizedStoreId <= 0) {
      return null;
    }

    return this.prisma.storeMembershipProfile.findUnique({
      where: { storeId: normalizedStoreId },
      select: PROFILE_SELECT,
    });
  }
}
