// 客存 B 端读服务：列表游标分页、详情 + 取出流水、统计聚合与门店配置读取
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CustodyCodeService } from '../../../shared/custody/custody-code.service';
import { resolveCustodyStoreSnapshot } from '../../../shared/custody/custody-store-snapshot';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import {
  CUSTODY_EXPIRING_SOON_DAYS,
  CUSTODY_ORDER_NOT_FOUND_MESSAGE,
  CUSTODY_PICKUP_RECORD_LIMIT,
} from './custody.constants';
import {
  buildCustodyFilterKey,
  resolveCustodyOperatorRoleFromMembership,
  resolveCustodyOperatorRoleFromStaff,
  type CustodyOperatorRole,
} from './custody.domain';
import {
  mapCustodyOrder,
  mapCustodySettings,
  mapPickupRecord,
} from './custody.mapper';
import { buildCountWhere, buildListQuery, encodeCursor } from './custody.query';
import type {
  CustodyOrderDetailResponseDto,
  CustodyOrderListResponseDto,
  CustodySettingsDto,
  CustodyStatsDto,
} from './dto/custody-response.dto';
import type { CustodyListParams } from './custody.types';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 统计缓存载荷。
 *
 * 统计是「截至某个时刻」的口径，会随时间漂移，所以缓存不能只存结果：
 * 必须同时记下口径会在哪个时刻失效，否则会出现「统计显示在存 10 件、
 * 列表此刻只有 9 条」的同屏不一致。
 */
interface CustodySummaryCachePayload {
  /** 聚合结果 */
  stats: CustodyStatsDto;
  /**
   * 口径有效截止时间（ISO 字符串）。
   * 当前时间越过它之后统计就会随时间漂移，必须重算；null 表示永不漂移。
   */
  validUntil: string | null;
}

@Injectable()
export class CustodyReadService {
  private readonly logger = new Logger(CustodyReadService.name);

  /**
   * 门店统计聚合的在途任务：storeId → 聚合 Promise。
   *
   * 只用于合并同一门店的并发聚合（防缓存击穿），任务结束即从表中移除，
   * 不做长期缓存（真正的缓存仍在 Redis，且带口径有效期）。
   */
  private readonly summaryInFlight = new Map<
    number,
    Promise<CustodyStatsDto>
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly custodyCodeService: CustodyCodeService,
  ) {}

  /** 列表查询：游标分页 + 总条数 + 门店统计 */
  async listOrders(
    user: AuthenticatedUser,
    params: Omit<CustodyListParams, 'storeId'>,
  ): Promise<CustodyOrderListResponseDto> {
    const storeId = await this.resolveViewStoreId(user);
    const now = new Date();
    const query = buildListQuery({ ...params, storeId }, now);
    const [records, total, summary] = await Promise.all([
      this.prisma.custodyOrder.findMany(query),
      this.resolveTotal(storeId, params, now),
      this.getSummary(storeId, now),
    ]);

    const roleById = await this.resolveOperatorRoles(
      storeId,
      records.map((record) => record.createdByStaffId),
    );
    const hasMore = records.length > params.limit;
    const items = records
      .slice(0, params.limit)
      .map((record) =>
        mapCustodyOrder(
          record,
          now,
          this.pickRole(roleById, record.createdByStaffId),
        ),
      );
    const nextCursor =
      hasMore && items.length > 0
        ? encodeCursor(records[params.limit - 1]!)
        : null;

    return { items, nextCursor, total, summary };
  }

  /**
   * 列表总条数：优先读缓存，未命中才落库 count。
   *
   * 总条数只随写操作变化、不随时间漂移，而任何客存写操作都会整键失效，
   * 因此可以安全缓存——列表是最热的读路径，省掉它等于每请求少一次全量 count。
   */
  private async resolveTotal(
    storeId: number,
    params: Omit<CustodyListParams, 'storeId'>,
    now: Date,
  ): Promise<number> {
    const filterKey = buildCustodyFilterKey(params);
    const cached = await this.custodyCodeService.readTotal(storeId, filterKey);
    if (cached !== null) {
      return cached;
    }
    const total = await this.prisma.custodyOrder.count({
      where: buildCountWhere({ ...params, storeId }, now),
    });
    await this.custodyCodeService.writeTotal(storeId, filterKey, total);
    return total;
  }

  /** 详情：存单 + 最近取出流水 */
  async getOrderDetail(
    user: AuthenticatedUser,
    orderId: number,
  ): Promise<CustodyOrderDetailResponseDto> {
    const storeId = await this.resolveViewStoreId(user);
    const now = new Date();
    const order = await this.prisma.custodyOrder.findFirst({
      where: { id: orderId, storeId, deletedAt: null },
    });
    if (!order) {
      throw new NotFoundException(CUSTODY_ORDER_NOT_FOUND_MESSAGE);
    }

    const pickupRecords = await this.prisma.custodyPickup.findMany({
      where: { custodyOrderId: order.id, deletedAt: null },
      orderBy: [{ pickedAt: 'desc' }, { id: 'desc' }],
      take: CUSTODY_PICKUP_RECORD_LIMIT,
    });

    const roleById = await this.resolveOperatorRoles(storeId, [
      order.createdByStaffId,
      ...pickupRecords.map((record) => record.operatorStaffId),
    ]);

    return {
      order: mapCustodyOrder(
        order,
        now,
        this.pickRole(roleById, order.createdByStaffId),
      ),
      pickupRecords: pickupRecords.map((record) =>
        mapPickupRecord(
          record,
          this.pickRole(roleById, record.operatorStaffId),
        ),
      ),
    };
  }

  /** 单个店员的角色解析：写 / 核销服务回写响应时复用，避免各处各写一份查询 */
  async resolveOperatorRole(
    storeId: number,
    staffId: number | null,
  ): Promise<CustodyOperatorRole> {
    const roleById = await this.resolveOperatorRoles(storeId, [staffId]);
    return this.pickRole(roleById, staffId);
  }

  /**
   * 当前登录主体作为经手人时的角色：直接从登录态推导，完全不查库。
   *
   * 仅用于「存单经手人就是当前登录者」的路径（如发起存入）；
   * 展示历史经手人的路径必须用 resolveOperatorRole 按员工档案解析。
   * 门店快照走缓存，因此这里通常连门店表都不用读。
   */
  async resolveSelfRole(
    user: AuthenticatedUser,
    storeId: number,
  ): Promise<CustodyOperatorRole> {
    const snapshot = await resolveCustodyStoreSnapshot(
      this.prisma,
      this.custodyCodeService,
      storeId,
    );
    return resolveCustodyOperatorRoleFromMembership(
      user.currentMembership,
      user.id,
      snapshot.ownerId,
    );
  }

  /**
   * 批量解析店员角色：一次查询覆盖存单经手与取出流水两个来源的 staffId。
   *
   * 主账号判定以 store.ownerId 为权威依据（历史店员行的 role 可能未同步，
   * 老板的 staff 行可能是 manager），同时带出子账号角色识别店长。
   * 历史单据的店员档案可能已被删除，此时查不到记录，由 pickRole 兜底为操作员。
   */
  private async resolveOperatorRoles(
    storeId: number,
    staffIds: readonly (number | null)[],
  ): Promise<Map<number, CustodyOperatorRole>> {
    const uniqueIds = Array.from(
      new Set(staffIds.filter((id): id is number => id !== null)),
    );
    if (uniqueIds.length === 0) {
      return new Map();
    }

    const [ownerUserId, staffs] = await Promise.all([
      this.resolveStoreOwnerId(storeId),
      this.prisma.staff.findMany({
        where: { id: { in: uniqueIds } },
        select: {
          id: true,
          role: true,
          userId: true,
          employeeProfile: {
            select: { subAccounts: { select: { role: true } } },
          },
        },
      }),
    ]);

    return new Map(
      staffs.map((staff) => [
        staff.id,
        resolveCustodyOperatorRoleFromStaff(
          {
            role: staff.role,
            userId: staff.userId,
            subAccountRole: staff.employeeProfile?.subAccounts?.role ?? null,
          },
          ownerUserId,
        ),
      ]),
    );
  }

  /** 取指定店员的角色：查不到档案（已删除 / 系统行为）时兜底为操作员 */
  private pickRole(
    roleById: Map<number, CustodyOperatorRole>,
    staffId: number | null,
  ): CustodyOperatorRole {
    return (staffId === null ? undefined : roleById.get(staffId)) ?? 'staff';
  }

  /**
   * 门店主账号的登录用户 ID：走门店快照缓存。
   *
   * 主账号判定是权威依据（员工行的 role 可能未同步），但门店行几乎不变，
   * 每个列表 / 详情请求都读一遍纯属浪费。
   */
  private async resolveStoreOwnerId(storeId: number): Promise<number | null> {
    const snapshot = await resolveCustodyStoreSnapshot(
      this.prisma,
      this.custodyCodeService,
      storeId,
    );
    return snapshot.ownerId;
  }

  /**
   * 门店配置读取：优先读缓存，未命中时落库；无记录时返回默认口径，不落库。
   *
   * 配置是写路径（发起存入 / 核销校验 / 确认取出）都要读一遍的门店级数据，
   * 而它只在「门店改配置」时才变，更新接口会主动失效缓存。
   */
  async getSettings(storeId: number): Promise<CustodySettingsDto> {
    const cached =
      await this.custodyCodeService.readSettingsCache<CustodySettingsDto>(
        storeId,
      );
    if (cached) {
      return cached;
    }
    const settings = mapCustodySettings(await this.findSetting(storeId));
    await this.custodyCodeService.writeSettingsCache(storeId, settings);
    return settings;
  }

  /** 门店配置实体读取（写服务复用） */
  findSetting(storeId: number) {
    return this.prisma.custodySetting.findFirst({
      where: { storeId, deletedAt: null },
    });
  }

  /**
   * 门店统计：优先读 Redis 缓存，未命中或口径已失效则聚合后回写。
   *
   * 列表的 total 永远是实时的，而统计走缓存；若缓存结果的时间口径已经漂移，
   * 同屏就会出现两个对不上的数。因此缓存命中后还要比对 validUntil，
   * 越过该时刻即视为失效并重新聚合。
   */
  async getSummary(storeId: number, now: Date): Promise<CustodyStatsDto> {
    const cached =
      await this.custodyCodeService.readSummaryCache<CustodySummaryCachePayload>(
        storeId,
      );
    if (cached) {
      const stillValid =
        cached.validUntil === null || now < new Date(cached.validUntil);
      if (stillValid) {
        return cached.stats;
      }
    }

    /*
     * 缓存失效的瞬间，同门店的并发请求会各自跑一遍聚合（缓存击穿）。
     * 同一门店共用同一个在途 Promise：只有一个请求真正落库聚合，其余复用结果。
     * 统计口径是门店级的，这样做不会引入个人数据串号。
     */
    const inFlight = this.summaryInFlight.get(storeId);
    if (inFlight) {
      return inFlight;
    }
    const task = this.recomputeSummary(storeId, now);
    this.summaryInFlight.set(storeId, task);
    try {
      return await task;
    } finally {
      this.summaryInFlight.delete(storeId);
    }
  }

  /** 重新聚合并回写缓存（统计缓存的单飞体） */
  private async recomputeSummary(
    storeId: number,
    now: Date,
  ): Promise<CustodyStatsDto> {
    const aggregated = await this.aggregateSummary(storeId, now);
    await this.custodyCodeService.writeSummaryCache(storeId, {
      stats: aggregated.stats,
      validUntil:
        aggregated.validUntil === null
          ? null
          : aggregated.validUntil.toISOString(),
    } satisfies CustodySummaryCachePayload);
    return aggregated.stats;
  }

  /**
   * 统计聚合：在存量、在存件数、临期单量、本月取出次数。
   *
   * 同时算出「口径有效截止时间」，供缓存判断结果何时会随时间漂移。
   */
  private async aggregateSummary(
    storeId: number,
    now: Date,
  ): Promise<{ stats: CustodyStatsDto; validUntil: Date | null }> {
    const expiringEdge = new Date(
      now.getTime() + CUSTODY_EXPIRING_SOON_DAYS * DAY_MS,
    );
    const monthStart = this.buildMonthStart(now);

    /*
     * 在存口径必须与列表「在存」Tab 完全一致：排除惰性过期（expireAt <= now）。
     * 否则会出现「统计显示在存 10 件、列表在存 Tab 只有 7 条」的对不上账。
     */
    const activeStoredWhere = {
      storeId,
      deletedAt: null,
      status: 'stored' as const,
      OR: [{ expireAt: null }, { expireAt: { gt: now } }],
    };

    /*
     * 在存单量、在存件数、最近的到期临界点三者同条件，合并成一次 aggregate
     * （count + sum + min）：分开是三条几乎一样的 SQL，
     * 而列表统计每次首屏都要跑一遍。
     */
    const [storedAgg, expiringCount, monthPickupCount, nextEnteringWindow] =
      await Promise.all([
        this.prisma.custodyOrder.aggregate({
          where: activeStoredWhere,
          _count: { _all: true },
          _sum: { remainingQty: true },
          _min: { expireAt: true },
        }),
        this.prisma.custodyOrder.count({
          where: {
            storeId,
            deletedAt: null,
            status: 'stored',
            expireAt: { gt: now, lte: expiringEdge },
          },
        }),
        this.prisma.custodyPickup.count({
          where: {
            storeId,
            deletedAt: null,
            pickedAt: { gte: monthStart },
          },
        }),
        // 最近的「进入临期窗口」临界点
        this.prisma.custodyOrder.findFirst({
          where: {
            storeId,
            deletedAt: null,
            status: 'stored',
            expireAt: { gt: expiringEdge },
          },
          orderBy: { expireAt: 'asc' },
          select: { expireAt: true },
        }),
      ]);

    /*
     * 统计随时间漂移有三个来源，各自对应一个临界时间点：
     * 1. 在存单越过 expireAt → 惰性过期，跌出 storedCount / storedQty；
     *    临界点直接取聚合带出的最小到期时间（与 storedCount 出自同一份在存集合，
     *    因此不必再单独查一次「最近的到期单」）。
     * 2. 存单进入临期窗口（expireAt − 临期阈值）→ expiringCount 加一；
     * 3. 自然月翻篇 → monthPickupCount 的统计区间整体平移，必须清零重算。
     *    少了这一条，门店在存的全是长期有效单（无到期临界点）时 boundaries 只剩空、
     *    validUntil 退化成 null 即「永不漂移」，跨月后「本月取出次数」会一直挂着上月的数字。
     * 取所有临界点中最早的那个作为口径有效截止时间，在此之前统计不随时间变化。
     */
    const boundaries: number[] = [this.buildNextMonthStart(now).getTime()];
    const nextExpiring = storedAgg._min.expireAt;
    if (nextExpiring) {
      boundaries.push(nextExpiring.getTime());
    }
    if (nextEnteringWindow?.expireAt) {
      boundaries.push(
        nextEnteringWindow.expireAt.getTime() -
          CUSTODY_EXPIRING_SOON_DAYS * DAY_MS,
      );
    }
    const validUntil = new Date(Math.min(...boundaries));

    return {
      stats: {
        storedCount: storedAgg._count._all,
        storedQty: storedAgg._sum.remainingQty ?? 0,
        expiringCount,
        monthPickupCount,
      },
      validUntil,
    };
  }

  private resolveViewStoreId(user: AuthenticatedUser): Promise<number> {
    return this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'custody:view',
      '无权查看当前门店的客存数据',
    );
  }

  /** 自然月起始时间（UTC） */
  private buildMonthStart(now: Date): Date {
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
    );
  }

  /**
   * 下个自然月的起始时间（UTC）：monthPickupCount 的统计区间在这个时刻整体平移。
   *
   * Date.UTC 会自行处理月份溢出（12 月 → 次年 1 月），无需额外归一。
   */
  private buildNextMonthStart(now: Date): Date {
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0),
    );
  }
}
