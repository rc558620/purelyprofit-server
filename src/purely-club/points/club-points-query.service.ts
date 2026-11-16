import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  ClubPointsFilterValue,
  ClubPointsSummaryDto,
} from './dto/club-points-record.dto';
import type { ClubPointsBalanceWindow } from './club-points-snapshot.util';
import { queryPointsBalanceWindow } from './club-points-balance-window.query';

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

/** 积分记录游标载荷（解码后）：时间 + ID 用于定位（同刻记录按 ID 补足次序） */
export interface ClubPointsCursorPayload {
  /** 上一页最后一条记录的创建时间 ISO 字符串 */
  createdAt: string;
  /** 上一页最后一条记录的数字 ID */
  id: number;
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
   * 按门店查询顾客记录（积分余额）。
   *
   * 优先级：`(storeId, clubUserId)` 权威锚点 → 按手机号认领**无主**档案，落空则返回 null。
   *
   * 锚点在前：手机号会变（换绑后旧号可能被他人注册），单靠它匹配在档案错乱时
   * 会把别人的积分当成自己的。
   *
   * 兜底必须带 `clubUserId: null` 限定：同一门店可能存在两条相同手机号的档案，
   * 其中一条已归属他人，不限定的话 `findFirst` 命中哪条并不确定。
   * 也不做「门店 + phone IS NULL」的模糊兜底——那同样可能命中同店他人档案，
   * 返回空列表比展示他人数据安全。
   *
   * @param clubUserId 当前用户 ID，必填。未绑手机号用户的档案 phone 可能为 null，
   *   此时它是唯一可靠的认人依据。
   */
  async findCustomerByStoreAndPhone(
    storeId: number,
    phone: string,
    clubUserId: number,
  ): Promise<ClubPointsCustomerRecord | null> {
    const bound = await this.prisma.marketingCustomer.findFirst({
      where: { storeId, clubUserId, deletedAt: null },
      select: { id: true, points: true },
    });

    if (bound) {
      return bound;
    }

    return this.prisma.marketingCustomer.findFirst({
      where: { storeId, phone, clubUserId: null, deletedAt: null },
      select: { id: true, points: true },
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
   *
   * 同时返回 balanceWindow（不早于本页最旧一条的**全量**积分流水聚合值，不含类型筛选），
   * 供上层做余额快照正推——快照若基于筛选后的记录，被排除的流水会凭空抬高压低余额。
   * 窗口求和已下推到 DB（窗口函数），只回传标量，不再随流水长度拉回全量行。
   */
  async listPointsRecords(
    storeId: number,
    customerId: number,
    filterType: ClubPointsFilterValue = 'all',
    options: ListPointsRecordsOptions = {},
  ): Promise<{
    items: ClubPointsRecordRow[];
    total: number;
    /** 余额快照基准：不早于本页最旧一条的全量积分流水聚合值 */
    balanceWindow: ClubPointsBalanceWindow | null;
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

    const typeFilter = buildPointsRecordTypeFilter(filterType);

    const [items, total] = await Promise.all([
      this.prisma.marketingPointsRecord.findMany({
        where: {
          storeId,
          customerId,
          ...typeFilter,
          ...cursorFilter,
        },
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
      // total 语义为「符合当前筛选条件的总条数」，不能带上游标条件（否则翻页后只剩剩余条数）
      this.prisma.marketingPointsRecord.count({
        where: { storeId, customerId, ...typeFilter },
      }),
    ]);

    // 余额快照基准：本页最旧一条之后（含）的全量流水已全部覆盖，
    // 因此可由当前余额精确反推出该时点余额（与储值流水同理）。
    // 求和下推到 DB 窗口函数，只回传本页 ≤limit 条标量。
    const oldestRow = items.length > 0 ? items[items.length - 1] : null;
    const balanceWindow = oldestRow
      ? await queryPointsBalanceWindow(this.prisma, {
          storeId,
          customerId,
          since: oldestRow.createdAt,
          recordIds: items.map((item) => item.id),
        })
      : null;

    return { items, total, balanceWindow };
  }
}
