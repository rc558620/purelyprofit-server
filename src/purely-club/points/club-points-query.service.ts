import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { ClubPointsFilterValue } from './dto/club-points-record.dto';

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
      where: { storeId, phone: null },
      select: { id: true, points: true },
      orderBy: { id: 'asc' },
    });
  }

  /**
   * 列出指定顾客在指定门店的积分明细（按时间倒序）。
   * 支持按类型筛选，筛选条件下推到 DB 层确保 total 与 items 一致。
   */
  async listPointsRecords(
    storeId: number,
    customerId: number,
    filterType: ClubPointsFilterValue = 'all',
    limit = 200,
  ): Promise<{ items: ClubPointsRecordRow[]; total: number }> {
    const where = {
      storeId,
      customerId,
      ...buildPointsRecordTypeFilter(filterType),
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

    return { items, total };
  }
}
