// 客存 C 端读服务：会员维度列表、详情 + 流水与汇总，memberId 由「门店 + 手机号」定位
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CustodyCodeService } from '../../shared/custody/custody-code.service';
import { resolveCustodyMemberId } from '../../shared/custody/custody-member.resolver';
import type { CustodyListParams } from '../../purely-profit/operations/custody/custody.types';
import {
  buildListQuery,
  encodeCursor,
} from '../../purely-profit/operations/custody/custody.query';
import {
  CUSTODY_EXPIRING_SOON_DAYS,
  CUSTODY_ORDER_NOT_FOUND_MESSAGE,
  CUSTODY_PICKUP_RECORD_LIMIT,
} from '../../purely-profit/operations/custody/custody.constants';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import {
  mapClubCustodyOrder,
  mapClubPickupRecord,
} from './club-custody.mapper';
import type {
  ClubCustodyOrderDetailResponseDto,
  ClubCustodyOrderListResponseDto,
  ClubCustodySummaryDto,
} from './dto/club-custody.dto';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ClubCustodyReadService {
  private readonly logger = new Logger(ClubCustodyReadService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly custodyCodeService: CustodyCodeService,
  ) {}

  /** 会员在当前门店的会员档案 ID（找不到返回 null，对应未登记会员） */
  findMemberId(context: ClubCurrentContext): Promise<number | null> {
    // 与 C 端实时房间共用同一口径，避免"能查客存但收不到推送"
    return resolveCustodyMemberId(
      this.prisma,
      context.store.id,
      context.user.phone,
    );
  }

  /**
   * 我的客存列表。
   *
   * 会员可见范围：作废单永不透出；草稿单仅在 `status=draft`
   * （待确认入口）时透出，其余筛选一律剔除。
   */
  async listOrders(
    context: ClubCurrentContext,
    params: Omit<CustodyListParams, 'storeId'>,
  ): Promise<ClubCustodyOrderListResponseDto> {
    const memberId = await this.findMemberId(context);
    const empty = { storedCount: 0, pickedCount: 0, expiringCount: 0, pendingCount: 0 };
    if (memberId === null) {
      return { items: [], nextCursor: null, summary: empty };
    }

    const now = new Date();
    const query = buildListQuery({ ...params, storeId: context.store.id }, now);
    const [records, summary] = await Promise.all([
      this.prisma.custodyOrder.findMany({
        ...query,
        where: {
          AND: [
            query.where,
            { memberId },
            this.buildVisibilityWhere(params.status),
          ],
        },
      }),
      this.getSummary(context.store.id, memberId, now),
    ]);

    const hasMore = records.length > params.limit;
    const items = records
      .slice(0, params.limit)
      .map((record) => mapClubCustodyOrder(record, context.store.name, now));

    return {
      items,
      nextCursor: hasMore ? encodeCursor(records[params.limit - 1]!) : null,
      summary,
    };
  }

  /** 我的客存详情：校验归属后返回存单与取出流水 */
  async getOrderDetail(
    context: ClubCurrentContext,
    orderId: number,
  ): Promise<ClubCustodyOrderDetailResponseDto> {
    const memberId = await this.findMemberId(context);
    if (memberId === null) {
      throw new NotFoundException(CUSTODY_ORDER_NOT_FOUND_MESSAGE);
    }

    const now = new Date();
    const order = await this.prisma.custodyOrder.findFirst({
      where: {
        id: orderId,
        storeId: context.store.id,
        memberId,
        deletedAt: null,
      },
    });
    if (!order) {
      throw new NotFoundException(CUSTODY_ORDER_NOT_FOUND_MESSAGE);
    }

    const pickups = await this.prisma.custodyPickup.findMany({
      where: { custodyOrderId: order.id, deletedAt: null },
      orderBy: [{ pickedAt: 'desc' }, { id: 'desc' }],
      take: CUSTODY_PICKUP_RECORD_LIMIT,
    });

    return {
      order: mapClubCustodyOrder(order, context.store.name, now),
      pickupRecords: pickups.map((record) =>
        mapClubPickupRecord(record, context.store.name),
      ),
    };
  }

  /** 会员可见范围条件：draft 仅待确认入口透出，void 永不透出 */
  private buildVisibilityWhere(
    status: string | undefined,
  ): Prisma.CustodyOrderWhereInput {
    return status === 'draft'
      ? { status: 'draft' }
      : { status: { notIn: ['draft', 'void'] } };
  }

  /** 会员维度汇总：在存单量 / 已取件数 / 临期单量 */
  private async getSummary(
    storeId: number,
    memberId: number,
    now: Date,
  ): Promise<ClubCustodySummaryDto> {
    const expiringEdge = new Date(
      now.getTime() + CUSTODY_EXPIRING_SOON_DAYS * DAY_MS,
    );
    const [storedCount, pendingCount, expiringCount, pickedAgg] = await Promise.all([
      this.prisma.custodyOrder.count({
        where: {
          storeId,
          memberId,
          deletedAt: null,
          status: 'stored',
          OR: [{ expireAt: null }, { expireAt: { gt: now } }],
        },
      }),
      // 待确认总数：草稿不进主列表 Tab，徽标必须走独立计数而非预览数组长度
      this.prisma.custodyOrder.count({
        where: {
          storeId,
          memberId,
          deletedAt: null,
          status: 'draft',
        },
      }),
      this.prisma.custodyOrder.count({
        where: {
          storeId,
          memberId,
          deletedAt: null,
          status: 'stored',
          expireAt: { gt: now, lte: expiringEdge },
        },
      }),
      this.prisma.custodyPickup.aggregate({
        where: {
          storeId,
          deletedAt: null,
          custodyOrder: { memberId, deletedAt: null },
        },
        _sum: { qty: true },
      }),
    ]);

    return {
      storedCount,
      expiringCount,
      pendingCount,
      pickedCount: pickedAgg._sum.qty ?? 0,
    };
  }
}
