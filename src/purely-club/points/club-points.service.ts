import { Injectable } from '@nestjs/common';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import type {
  ClubPointsRecordDto,
  ClubPointsRecordTypeValue,
  ClubPointsRecordsResponseDto,
  ListClubPointsRecordsQueryDto,
} from './dto/club-points-record.dto';
import type {
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
        summary: { totalEarned: 0, totalRedeemed: 0 },
      };
    }

    // 筛选条件下推到 DB 层，确保 total 与 items 语义一致
    const filterType = query.type ?? 'all';
    const { items: rows, total } =
      await this.clubPointsQueryService.listPointsRecords(
        currentContext.store.id,
        customer.id,
        filterType,
      );

    const [items, summary] = await Promise.all([
      Promise.resolve(this.buildItems(rows, customer, currentContext.store.name)),
      this.clubPointsQueryService.calculateSummary(
        currentContext.store.id,
        customer.id,
      ),
    ]);

    return { items, total, summary };
  }

  /**
   * 将积分记录行转换为前端 DTO，并计算每条记录后的积分余额快照。
   *
   * 余额快照算法（正推法，与 ClubRecordViewService 一致）：
   * 1. 按时间正序排列
   * 2. 起始积分 = customer.points - 所有已加载记录的 amount 之和
   * 3. 从最旧到最新逐条累加，得到每条记录后的快照
   * 4. 最终仍按倒序输出（最新在前）
   */
  private buildItems(
    rows: ClubPointsRecordRow[],
    customer: ClubPointsCustomerRecord,
    storeName: string,
  ): ClubPointsRecordDto[] {
    if (rows.length === 0) {
      return [];
    }

    const ascending = [...rows].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
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
