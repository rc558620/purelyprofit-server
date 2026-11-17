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

/** 顾客档案 + 会员绑定关系（签到链路一次性取全所需字段，避免回读同一行） */
export interface ClubPointsCustomerLinkRecord extends ClubPointsCustomerRecord {
  /** 关联会员档案 ID，无则为 null */
  memberId: number | null;
  /** 绑定的小程序用户 ID，无主档案为 null */
  clubUserId: number | null;
}

/** 积分汇总原生聚合行：SUM 在 PG 侧返回 bigint，需转 number 对齐 DTO */
interface ClubPointsSummaryAggregateRow {
  totalEarned: bigint;
  totalRedeemed: bigint;
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
  /** 是否统计总条数，默认 true；传 false 时跳过 count，翻页判定改用 hasMore */
  withTotal?: boolean;
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
   * 与 findCustomerByStoreAndPhone 同锚定口径，但一次性带回 memberId / clubUserId。
   *
   * 签到链路既需要积分又需要会员绑定关系：先调上面的方法再按 id 回查同一行，
   * 会让单请求多出一次同表往返。这里把字段合并进同一条查询，命中锚点即结束。
   */
  async findCustomerWithMemberLink(
    storeId: number,
    phone: string,
    clubUserId: number,
  ): Promise<ClubPointsCustomerLinkRecord | null> {
    const bound = await this.prisma.marketingCustomer.findFirst({
      where: { storeId, clubUserId, deletedAt: null },
      select: {
        id: true,
        points: true,
        memberId: true,
        clubUserId: true,
      },
    });

    if (bound) {
      return bound;
    }

    return this.prisma.marketingCustomer.findFirst({
      where: { storeId, phone, clubUserId: null, deletedAt: null },
      select: {
        id: true,
        points: true,
        memberId: true,
        clubUserId: true,
      },
    });
  }

  /**
   * 计算指定客户在指定门店的积分汇总：累计获得积分、累计消耗积分。
   *
   * 改前是 `amount > 0` / `amount < 0` 两条 aggregate 并行发出：同一张
   * `marketing_points_records`、同一 `(store_id, customer_id)` 条件各扫一遍。
   * 两条查询的谓词互为补集、表与等值条件完全相同，因此用一条 `FILTER` 聚合
   * 一次算完：PG 查询数 2 → 1，该顾客积分流水的扫描量减半。
   *
   * 与 `club-custody-read.service.ts` 的 `aggregateSummary` 保持同一范式
   * （单条 SQL + FILTER 多指标），避免同模块内两种聚合口径并存。
   */
  async calculateSummary(
    storeId: number,
    customerId: number,
  ): Promise<ClubPointsSummaryDto> {
    const rows = await this.prisma.$queryRaw<ClubPointsSummaryAggregateRow[]>`
      SELECT
        COALESCE(SUM("amount") FILTER (WHERE "amount" > 0), 0)::bigint
          AS "totalEarned",
        COALESCE(SUM("amount") FILTER (WHERE "amount" < 0), 0)::bigint
          AS "totalRedeemed"
      FROM "marketing_points_records"
      WHERE "store_id" = ${storeId}
        AND "customer_id" = ${customerId}
    `;

    // FILTER 聚合无 GROUP BY，恒返回一行；`rows[0]` 缺失只是类型层面的兜底
    const row = rows[0];
    return {
      totalEarned: Number(row?.totalEarned ?? 0),
      totalRedeemed: Math.abs(Number(row?.totalRedeemed ?? 0)),
    };
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
    total: number | null;
    /** 是否还有下一页：由多取一行判定，与 total 是否统计无关 */
    hasMore: boolean;
    /** 余额快照基准：不早于本页最旧一条的全量积分流水聚合值 */
    balanceWindow: ClubPointsBalanceWindow | null;
  }> {
    const { limit = 50, cursor, withTotal = true } = options;

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

    // 多取一行判断是否还有下一页：比再查一次 count 便宜得多
    const [rows, total] = await Promise.all([
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
        take: limit + 1,
      }),
      // total 语义为「符合当前筛选条件的总条数」，不能带上游标条件（否则翻页后只剩剩余条数）；
      // 翻页场景（withTotal=false）直接跳过这次 count
      withTotal
        ? this.prisma.marketingPointsRecord.count({
            where: { storeId, customerId, ...typeFilter },
          })
        : Promise.resolve(0),
    ]);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

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

    return { items, total: withTotal ? total : null, hasMore, balanceWindow };
  }
}
