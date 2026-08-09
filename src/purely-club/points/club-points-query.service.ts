import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  ClubPointsFilterValue,
  ClubPointsSummaryDto,
} from './dto/club-points-record.dto';

/** 积分记录查询结果行（对齐 MarketingPointsRecord 表字段） */
export interface ClubPointsRecordRow {
  id: number;
  amount: number;
  type: 'earn' | 'spend' | 'expire' | 'gift';
  description: string;
  createdAt: Date;
}

/** 积分顾客记录（用于余额快照计算） */
export interface ClubPointsCustomerRecord {
  id: number;
  /** 当前积分余额 */
  points: number;
}

/** 积分记录游标载荷（解码后）：时间 + ID 用于定位，totalEffect 用于余额快照连续正推 */
export interface ClubPointsCursorPayload {
  /** 上一页最后一条记录的创建时间 ISO 字符串 */
  createdAt: string;
  /** 上一页最后一条记录的数字 ID */
  id: number;
  /** 截止上一页最后一条记录（含）在当前筛选条件下的累计变动量 */
  totalEffect: number;
}

/** 积分记录分页查询参数 */
export interface ListPointsRecordsOptions {
  /** 每页条数，默认 50，最大 200 */
  limit?: number;
  /** 分页游标；不传表示第一页 */
  cursor?: ClubPointsCursorPayload;
}

/**
 * 将前端筛选类型映射为 Prisma where 条件。
 * - earn：amount > 0（获得类：earn + gift）
 * - redeem：amount < 0（消耗类：spend + expire）
 * - all：不筛选
 */
function buildPointsRecordTypeFilter(
  filterType: ClubPointsFilterValue,
): Prisma.MarketingPointsRecordWhereInput {
  switch (filterType) {
    case 'earn':
      return { amount: { gt: 0 } };
    case 'redeem':
      return { amount: { lt: 0 } };
    case 'all':
    default:
      return {};
  }
}

@Injectable()
export class ClubPointsQueryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 按门店 ID + 手机号查询顾客记录（积分余额）。
   * 逻辑与 ClubRecordQueryService.findCustomerByStoreAndPhone 保持一致。
   */
  async findCustomerByStoreAndPhone(
    storeId: number,
    phone: string,
  ): Promise<ClubPointsCustomerRecord | null> {
    const exact = await this.prisma.marketingCustomer.findFirst({
      where: {
        storeId,
        phone,
        deletedAt: null,
      },
      select: { id: true, points: true },
    });

    if (exact) {
      return exact;
    }

    // 回退：微信登录用户的 phone 格式为 "club_wechat:oOPENID123"
    // 注意：此回退逻辑在门店下存在多个无手机号顾客时可能匹配不准确，
    // 后续应通过微信 openid 建立营销顾客与微信用户的直接绑定关系
    if (!phone.startsWith('club_wechat:')) {
      return null;
    }

    return this.prisma.marketingCustomer.findFirst({
      where: { storeId, phone: null, deletedAt: null },
      select: { id: true, points: true },
      orderBy: { id: 'asc' },
    });
  }

  /**
   * 计算指定客户在指定门店的积分汇总：累计获得积分、累计消耗积分。
   * 使用数据库 SUM 聚合，保证精度且不需要前端遍历。
   */
  async calculateSummary(
    storeId: number,
    customerId: number,
  ): Promise<ClubPointsSummaryDto> {
    const [earnedResult, redeemedResult] = await Promise.all([
      this.prisma.marketingPointsRecord.aggregate({
        where: {
          storeId,
          customerId,
          amount: { gt: 0 },
        },
        _sum: {
          amount: true,
        },
      }),
      this.prisma.marketingPointsRecord.aggregate({
        where: {
          storeId,
          customerId,
          amount: { lt: 0 },
        },
        _sum: {
          amount: true,
        },
      }),
    ]);

    const totalEarned = earnedResult._sum.amount ?? 0;
    const totalRedeemed = Math.abs(redeemedResult._sum.amount ?? 0);

    return { totalEarned, totalRedeemed };
  }

  /**
   * 列出指定顾客在指定门店的积分明细（按时间倒序）。
   * 支持按类型筛选与游标分页，筛选条件下推到 DB 层确保 total 与 items 一致。
   * 返回 baseEffect（游标之前的累计变动量）供上层余额快照正推。
   */
  async listPointsRecords(
    storeId: number,
    customerId: number,
    filterType: ClubPointsFilterValue = 'all',
    options: ListPointsRecordsOptions = {},
  ): Promise<{
    items: ClubPointsRecordRow[];
    total: number;
    /** 本次查询起点之前的累计变动量（首屏为 0，翻页取游标 totalEffect） */
    baseEffect: number;
  }> {
    const { limit = 50, cursor } = options;

    // 构建 cursor 过滤条件：比上一页最后一条更早的记录（同刻按 id 更小）
    const cursorFilter = cursor
      ? {
          OR: [
            { createdAt: { lt: cursor.createdAt } },
            {
              createdAt: cursor.createdAt,
              id: { lt: cursor.id },
            },
          ],
        }
      : {};

    const where = {
      storeId,
      customerId,
      ...buildPointsRecordTypeFilter(filterType),
      ...cursorFilter,
    } satisfies Prisma.MarketingPointsRecordWhereInput;

    const [items, total] = await Promise.all([
      this.prisma.marketingPointsRecord.findMany({
        where,
        select: {
          id: true,
          amount: true,
          type: true,
          description: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
      }),
      this.prisma.marketingPointsRecord.count({ where }),
    ]);

    return {
      items,
      total,
      baseEffect: cursor?.totalEffect ?? 0,
    };
  }
}
