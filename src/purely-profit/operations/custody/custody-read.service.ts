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

    const hasMore = records.length > params.limit;
    const items = records
      .slice(0, params.limit)
      .map((record) => mapCustodyOrder(record, now));
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

    return {
      order: mapCustodyOrder(order, now),
      pickupRecords: pickupRecords.map(mapPickupRecord),
    };
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

  /** 门店统计：优先读 Redis 缓存，未命中则聚合后回写 */
  async getSummary(storeId: number, now: Date): Promise<CustodyStatsDto> {
    const cached =
      await this.custodyCodeService.readSummaryCache<CustodyStatsDto>(storeId);
    if (cached) {
      return cached;
    }

    const summary = await this.aggregateSummary(storeId, now);
    await this.custodyCodeService.writeSummaryCache(storeId, summary);
    return summary;
  }

  /** 统计聚合：在存量、在存件数、临期单量、本月取出次数 */
  private async aggregateSummary(
    storeId: number,
    now: Date,
  ): Promise<CustodyStatsDto> {
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

    const [storedCount, storedQtyAgg, expiringCount, monthPickupCount] =
      await Promise.all([
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
      ]);

    return {
      storedCount,
      storedQty: storedQtyAgg._sum.remainingQty ?? 0,
      expiringCount,
      monthPickupCount,
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
