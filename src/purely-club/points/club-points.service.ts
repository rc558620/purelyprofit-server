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
      );

    if (!customer) {
      return {
        items: [],
        total: 0,
        nextCursor: null,
        summary: { totalEarned: 0, totalRedeemed: 0 },
      };
    }

    // 筛选条件下推到 DB 层，确保 total 与 items 语义一致；游标携带累计变动量供余额快照正推
    const filterType = query.type ?? 'all';
    const cursor = this.buildCursor(query);
    const {
      items: rows,
      total,
      baseEffect,
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
        this.buildItems(rows, customer, currentContext.store.name, baseEffect),
      ),
      this.clubPointsQueryService.calculateSummary(
        currentContext.store.id,
        customer.id,
      ),
    ]);

    // 计算下一页游标：本页有记录时，编码最后一条的时间、ID 与已加载累计变动量
    const pageEffect = rows.reduce((sum, row) => sum + row.amount, 0);
    const lastRow = rows.length > 0 ? rows[rows.length - 1] : null;
    const nextCursor = lastRow
      ? this.encodeCursor({
          createdAt: lastRow.createdAt.toISOString(),
          id: lastRow.id,
          totalEffect: baseEffect + pageEffect,
        })
      : null;

    return { items, total, nextCursor, summary };
  }

  /**
   * 从查询参数中解析单参数游标（base64url 编码的 { createdAt, id, totalEffect }）。
   * 不传表示第一页；格式非法时抛出 400 明确提示调用方。
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
      totalEffect?: number;
    };
    try {
      // JSON.parse 返回 any，此处用窄类型断言限定解析结果结构
      payload = JSON.parse(
        Buffer.from(query.cursor, 'base64url').toString('utf8'),
      ) as {
        createdAt?: string;
        id?: number;
        totalEffect?: number;
      };
    } catch {
      throw new BadRequestException('分页游标解析失败');
    }

    if (
      typeof payload.id !== 'number' ||
      typeof payload.createdAt !== 'string' ||
      typeof payload.totalEffect !== 'number' ||
      !Number.isFinite(payload.totalEffect)
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
      totalEffect: payload.totalEffect,
    };
  }

  /** 将上一页最后一条积分记录的时间、ID 与累计变动量编码为单参数游标（base64url JSON） */
  private encodeCursor(payload: ClubPointsCursorPayload): string {
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  }

  /**
   * 将积分记录行转换为前端 DTO，并计算每条记录后的积分余额快照。
   *
   * 余额快照算法（正推法，与 ClubRecordViewService 一致）：
   * 1. 按时间正序排列
   * 2. 起始积分 = customer.points - baseEffect - 本页已加载记录的 amount 之和
   *    （baseEffect 为游标之前已加载记录的累计变动量，首屏为 0，保证跨页快照连续）
   * 3. 从最旧到最新逐条累加，得到每条记录后的快照
   * 4. 最终仍按倒序输出（最新在前）
   */
  private buildItems(
    rows: ClubPointsRecordRow[],
    customer: ClubPointsCustomerRecord,
    storeName: string,
    baseEffect: number,
  ): ClubPointsRecordDto[] {
    if (rows.length === 0) {
      return [];
    }

    const ascending = [...rows].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );

    const pageEffect = ascending.reduce((sum, r) => sum + r.amount, 0);
    let runningPoints = customer.points - baseEffect - pageEffect;

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
