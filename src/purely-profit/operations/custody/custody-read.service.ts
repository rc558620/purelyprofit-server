// 客存 B 端读服务：列表游标分页、详情 + 取出流水、统计聚合与门店配置读取
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CustodyCodeService } from '../../../shared/custody/custody-code.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import {
  CUSTODY_EXPIRING_SOON_DAYS,
  CUSTODY_ORDER_NOT_FOUND_MESSAGE,
  CUSTODY_PICKUP_RECORD_LIMIT,
} from './custody.constants';
import {
  resolveCustodyOperatorRoleFromStaff,
  type CustodyOperatorRole,
} from './custody.domain';
import {
  mapCustodyOrder,
  mapCustodySettings,
  mapPickupRecord,
} from './custody.mapper';
import { buildListQuery, encodeCursor } from './custody.query';
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
      this.prisma.custodyOrder.count({ where: query.where }),
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

    const [store, staffs] = await Promise.all([
      this.prisma.store.findUnique({
        where: { id: storeId },
        select: { ownerId: true },
      }),
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
    const ownerUserId = store?.ownerId ?? null;

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

  /** 门店配置读取：不存在时返回默认口径，不落库 */
  async getSettings(storeId: number): Promise<CustodySettingsDto> {
    const record = await this.findSetting(storeId);
    return mapCustodySettings(record);
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
     * 统计随时间漂移只有两个来源，各自对应一个临界时间点：
     * 1. 在存单越过 expireAt → 惰性过期，跌出 storedCount / storedQty；
     * 2. 存单进入临期窗口（expireAt − 临期阈值）→ expiringCount 加一。
     * 取两个临界点中最早的那个作为口径有效截止时间，
     * 在此之前统计不随时间变化，缓存可以安全复用。
     */
    const [
      storedCount,
      storedQtyAgg,
      expiringCount,
      monthPickupCount,
      nextExpiring,
      nextEnteringWindow,
    ] = await Promise.all([
      this.prisma.custodyOrder.count({ where: activeStoredWhere }),
      this.prisma.custodyOrder.aggregate({
        where: activeStoredWhere,
        _sum: { remainingQty: true },
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
      // 最近的「跌出在存」临界点
      this.prisma.custodyOrder.findFirst({
        where: {
          storeId,
          deletedAt: null,
          status: 'stored',
          expireAt: { gt: now },
        },
        orderBy: { expireAt: 'asc' },
        select: { expireAt: true },
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

    const boundaries: number[] = [];
    if (nextExpiring?.expireAt) {
      boundaries.push(nextExpiring.expireAt.getTime());
    }
    if (nextEnteringWindow?.expireAt) {
      boundaries.push(
        nextEnteringWindow.expireAt.getTime() -
          CUSTODY_EXPIRING_SOON_DAYS * DAY_MS,
      );
    }
    const validUntil =
      boundaries.length > 0 ? new Date(Math.min(...boundaries)) : null;

    return {
      stats: {
        storedCount,
        storedQty: storedQtyAgg._sum.remainingQty ?? 0,
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
}
