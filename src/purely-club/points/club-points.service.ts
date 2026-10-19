import { BadRequestException, Injectable } from '@nestjs/common';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import type {
  ClubPointsRecordDto,
  ClubPointsRecordTypeValue,
  ClubPointsRecordsResponseDto,
  ListClubPointsRecordsQueryDto,
} from './dto/club-points-record.dto';
import type {
  ClubPointsBalanceRecordRow,
  ClubPointsCursorPayload,
  ClubPointsCustomerRecord,
  ClubPointsRecordRow,
} from './club-points-query.service';
import { ClubPointsQueryService } from './club-points-query.service';

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
    // 余额快照基准由查询层另取全量流水（balanceRecords），不受筛选影响
    const filterType = query.type ?? 'all';
    const cursor = this.buildCursor(query);
    const {
      items: rows,
      total,
      balanceRecords,
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
          balanceRecords,
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
      throw new BadRequestException('分页游标解析失败');
    }

    if (
      typeof payload.id !== 'number' ||
      typeof payload.createdAt !== 'string'
    ) {
      throw new BadRequestException('分页游标格式不合法');
    }

    const createdAt = new Date(payload.createdAt);
    if (Number.isNaN(createdAt.getTime())) {
      throw new BadRequestException('分页游标时间不合法');
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
   * 1. 对 balanceRecords（不早于本页最旧一条的全量流水）按时间 + ID 正序排列
   * 2. 起始积分 = customer.points - balanceRecords 变动量之和 = 最旧一条发生前的积分
   * 3. 从最旧到最新逐条累加，得到每条记录后的快照
   * 4. 最终仍按倒序输出（最新在前）
   *
   * ⚠️ 快照基准必须是**不受类型筛选影响的全量流水**（balanceRecords）。
   * 若误用按 Tab 过滤后的 rows，被排除的流水（如筛选「获得」时被排除的消耗）
   * 会让反推起点偏离真实余额，除最新一条外的快照全部失真。
   * 升序必须与展示排序（createdAt desc, id desc）严格互逆：同一事务写入的记录
   * createdAt 相同（Postgres now() 取事务开始时间），此时只能靠 ID 定序。
   */
  private buildItems(
    rows: ClubPointsRecordRow[],
    customer: ClubPointsCustomerRecord,
    storeName: string,
    balanceRecords: ClubPointsBalanceRecordRow[] = [],
  ): ClubPointsRecordDto[] {
    if (rows.length === 0) {
      return [];
    }

    // 快照基准缺省（旧调用/查询层未返回）时回退为本页 rows，保证向后兼容
    const balanceRows = balanceRecords.length > 0 ? balanceRecords : rows;

    const ascending = [...balanceRows].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id,
    );

    const totalEffect = ascending.reduce((sum, r) => sum + r.amount, 0);
    let runningPoints = customer.points - totalEffect;

    const snapshotMap = new Map<number, number>();
    for (const row of ascending) {
      runningPoints += row.amount;
      snapshotMap.set(row.id, runningPoints);
    }

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
