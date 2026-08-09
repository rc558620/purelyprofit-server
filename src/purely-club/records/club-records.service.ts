import { BadRequestException, Injectable } from '@nestjs/common';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import type {
  ClubRecordsResponseDto,
  ListClubRecordsQueryDto,
} from './dto/club-record.dto';
import { ClubRecordQueryService } from './club-record-query.service';
import { ClubRecordViewService } from './club-record-view.service';

@Injectable()
export class ClubRecordsService {
  constructor(
    private readonly clubRecordQueryService: ClubRecordQueryService,
    private readonly clubRecordViewService: ClubRecordViewService,
  ) {}

  async list(
    currentContext: ClubCurrentContext,
    query: ListClubRecordsQueryDto,
  ): Promise<ClubRecordsResponseDto> {
    const customer =
      await this.clubRecordQueryService.findCustomerByStoreAndPhone(
        currentContext.store.id,
        currentContext.user.phone,
      );

    if (!customer) {
      return {
        items: [],
        total: 0,
        nextCursor: null,
        summary: { totalRechargeAmount: 0, totalConsumeAmount: 0 },
      };
    }

    // 构建分页游标
    const cursor = this.buildCursor(query);

    const entries = await this.clubRecordQueryService.listLedgerEntries(
      currentContext.store.id,
      customer.id,
      {
        limit: query.limit,
        cursor,
        filterType: query.type ?? 'all',
      },
    );

    const filterType = query.type ?? 'all';
    const items = this.clubRecordViewService.buildRecordItems({
      entries: entries.items,
      filterType,
      customer,
      storeName: currentContext.store.name,
    });

    // BUG-2 修复：total 为查询层按类型筛选后的总条数，而非当前页条数
    const total = entries.total;

    // 计算下一页游标：如果当前页返回了记录，取最后一条编码为单参数游标
    const lastItem = items.length > 0 ? items[items.length - 1] : null;
    const nextCursor = lastItem
      ? this.encodeCursor(lastItem.createdAt, lastItem.id)
      : null;

    // 计算汇总：基于数据库聚合而非前端遍历，保证精度
    const summary = await this.clubRecordQueryService.calculateSummary(
      currentContext.store.id,
      customer.id,
    );

    return {
      items,
      total,
      nextCursor,
      summary,
    };
  }

  /**
   * 从查询参数中解析单参数游标（base64url 编码的 { createdAt, id }）。
   * 不传表示第一页；格式非法时抛出 400 明确提示调用方。
   */
  private buildCursor(
    query: ListClubRecordsQueryDto,
  ): { createdAt: Date; id: string } | undefined {
    if (!query.cursor) {
      return undefined;
    }

    let payload: { createdAt?: string; id?: string };
    try {
      // JSON.parse 返回 any，此处用窄类型断言限定解析结果结构
      payload = JSON.parse(
        Buffer.from(query.cursor, 'base64url').toString('utf8'),
      ) as { createdAt?: string; id?: string };
    } catch {
      throw new BadRequestException('分页游标解析失败');
    }

    if (
      typeof payload.id !== 'string' ||
      typeof payload.createdAt !== 'string'
    ) {
      throw new BadRequestException('分页游标格式不合法');
    }

    const createdAt = new Date(payload.createdAt);
    if (Number.isNaN(createdAt.getTime())) {
      throw new BadRequestException('分页游标时间不合法');
    }

    return { createdAt, id: payload.id };
  }

  /** 将上一页最后一条流水的创建时间与 ID 编码为单参数游标（base64url JSON） */
  private encodeCursor(createdAt: string, id: string): string {
    return Buffer.from(JSON.stringify({ createdAt, id }), 'utf8').toString(
      'base64url',
    );
  }
}
