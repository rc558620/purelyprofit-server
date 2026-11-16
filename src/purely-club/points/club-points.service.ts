import { CLUB_POINTS_ERROR_CODE, clubPointsError } from './club-points.errors';
import { BadRequestException, Injectable } from '@nestjs/common';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import type {
  ClubPointsRecordDto,
  ClubPointsRecordTypeValue,
  ClubPointsRecordsResponseDto,
  ListClubPointsRecordsQueryDto,
} from './dto/club-points-record.dto';
import type {
  ClubPointsCursorPayload,
  ClubPointsCustomerRecord,
  ClubPointsRecordRow,
} from './club-points-query.service';
import { ClubPointsQueryService } from './club-points-query.service';
import type { ClubPointsBalanceWindow } from './club-points-snapshot.util';
import {
  buildPointsSnapshotsFromRecords,
  buildPointsSnapshotsFromWindow,
} from './club-points-snapshot.util';

/** Prisma 积分类型 → 前端 DTO 类型映射 */
const POINTS_TYPE_MAP: Record<
  ClubPointsRecordRow['type'],
  ClubPointsRecordTypeValue
> = {
  earn: 'earn',
  spend: 'redeem',
  expire: 'expire',
  gift: 'earn',
};

@Injectable()
export class ClubPointsService {
  constructor(
    private readonly clubPointsQueryService: ClubPointsQueryService,
  ) {}

  async listRecords(
    currentContext: ClubCurrentContext,
    query: ListClubPointsRecordsQueryDto,
  ): Promise<ClubPointsRecordsResponseDto> {
    const customer =
      await this.clubPointsQueryService.findCustomerByStoreAndPhone(
        currentContext.store.id,
        currentContext.user.phone,
        // 未绑手机号用户按 clubUserId 认人，避免回落「同门店任意无手机号顾客」
        currentContext.user.id,
      );

    if (!customer) {
      return {
        items: [],
        total: 0,
        nextCursor: null,
        summary: { totalEarned: 0, totalRedeemed: 0 },
      };
    }

    // 筛选条件下推到 DB 层，确保 total 与 items 语义一致；
    // 余额快照基准由查询层另取全量流水聚合值（balanceWindow），不受筛选影响
    const filterType = query.type ?? 'all';
    const cursor = this.buildCursor(query);
    const {
      items: rows,
      total,
      balanceWindow,
    } = await this.clubPointsQueryService.listPointsRecords(
      currentContext.store.id,
      customer.id,
      filterType,
      {
        limit: query.limit,
        cursor,
      },
    );

    const [items, summary] = await Promise.all([
      Promise.resolve(
        this.buildItems(
          rows,
          customer,
          currentContext.store.name,
          balanceWindow,
        ),
      ),
      this.clubPointsQueryService.calculateSummary(
        currentContext.store.id,
        customer.id,
      ),
    ]);

    // 计算下一页游标：本页有记录时，编码最后一条的时间与 ID
    const lastRow = rows.length > 0 ? rows[rows.length - 1] : null;
    const nextCursor = lastRow
      ? this.encodeCursor({
          createdAt: lastRow.createdAt.toISOString(),
          id: lastRow.id,
        })
      : null;

    return { items, total, nextCursor, summary };
  }

  /**
   * 从查询参数中解析单参数游标（base64url 编码的 { createdAt, id }）。
   * 不传表示第一页；格式非法时抛出 400 明确提示调用方。
   *
   * 兼容说明：旧游标额外带 totalEffect（曾用于快照正推），现已不再需要，
   * 但仍接受以免历史游标在发版后直接 400。
   */
  private buildCursor(
    query: ListClubPointsRecordsQueryDto,
  ): ClubPointsCursorPayload | undefined {
    if (!query.cursor) {
      return undefined;
    }

    let payload: {
      createdAt?: string;
      id?: number;
    };
    try {
      // JSON.parse 返回 any，此处用窄类型断言限定解析结果结构
      payload = JSON.parse(
        Buffer.from(query.cursor, 'base64url').toString('utf8'),
      ) as {
        createdAt?: string;
        id?: number;
      };
    } catch {
      throw new BadRequestException(
        clubPointsError(
          CLUB_POINTS_ERROR_CODE.PARAM_CURSOR_PARSE_FAILED,
          '分页游标解析失败',
        ),
      );
    }

    if (
      typeof payload.id !== 'number' ||
      typeof payload.createdAt !== 'string'
    ) {
      throw new BadRequestException(
        clubPointsError(
          CLUB_POINTS_ERROR_CODE.PARAM_CURSOR_INVALID,
          '分页游标格式不合法',
        ),
      );
    }

    const createdAt = new Date(payload.createdAt);
    if (Number.isNaN(createdAt.getTime())) {
      throw new BadRequestException(
        clubPointsError(
          CLUB_POINTS_ERROR_CODE.PARAM_CURSOR_TIME_INVALID,
          '分页游标时间不合法',
        ),
      );
    }

    return {
      createdAt: createdAt.toISOString(),
      id: payload.id,
    };
  }

  /** 将上一页最后一条积分记录的时间与 ID 编码为单参数游标（base64url JSON） */
  private encodeCursor(payload: ClubPointsCursorPayload): string {
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  }

  /**
   * 将积分记录行转换为前端 DTO，并计算每条记录后的积分余额快照。
   *
   * 余额快照算法（正推法，与 ClubRecordViewService 一致）：
   * 1. 起始积分 = customer.points − 窗口内全部流水变动之和 = 最旧一条发生前的积分
   * 2. 每条快照 = 起始积分 + 该条在窗口内的累计变动（含自身）
   * 3. 最终仍按倒序输出（最新在前）
   *
   * ⚠️ 快照基准必须是**不受类型筛选影响的全量流水**（balanceWindow）。
   * 若误用按 Tab 过滤后的 rows，被排除的流水（如筛选「获得」时被排除的消耗）
   * 会让反推起点偏离真实余额，除最新一条外的快照全部失真。
   * 升序必须与展示排序（createdAt desc, id desc）严格互逆：同一事务写入的记录
   * createdAt 相同（Postgres now() 取事务开始时间），此时只能靠 ID 定序。
   *
   * 窗口求和已下推到 DB（只回传标量）；balanceWindow 缺省（旧调用/查询层未返回）时
   * 降级为本页 rows 全量反推，保持旧行为不变。
   */
  private buildItems(
    rows: ClubPointsRecordRow[],
    customer: ClubPointsCustomerRecord,
    storeName: string,
    balanceWindow: ClubPointsBalanceWindow | null = null,
  ): ClubPointsRecordDto[] {
    if (rows.length === 0) {
      return [];
    }

    const snapshotMap = balanceWindow
      ? buildPointsSnapshotsFromWindow(balanceWindow, customer.points)
      : buildPointsSnapshotsFromRecords(rows, customer.points);

    return rows.map((row) => ({
      id: `points-${row.id}`,
      type: POINTS_TYPE_MAP[row.type] ?? 'adjust',
      amount: row.amount,
      description: row.description.replace(/（[^）]*）$/, '').trim(),
      createdAt: row.createdAt.toISOString(),
      balanceSnapshot: snapshotMap.get(row.id) ?? 0,
      storeName,
    }));
  }
}
