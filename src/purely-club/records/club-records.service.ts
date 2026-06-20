import { Injectable } from '@nestjs/common';
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
        nextCursorCreatedAt: null,
        nextCursorId: null,
      };
    }

    // 构建分页游标
    const cursor = this.buildCursor(query);

    const entries = await this.clubRecordQueryService.listLedgerEntries(
      currentContext.store.id,
      customer.id,
      query.limit,
      cursor,
    );

    const filterType = query.type ?? 'all';
    const items = this.clubRecordViewService.buildRecordItems({
      entries: entries.items,
      filterType,
      customer,
      storeName: currentContext.store.name,
    });

    // BUG-2 修复：total 应为筛选后的条目数，而非数据库原始总数
    const total = items.length;

    // 计算下一页游标：如果当前页返回了记录，取最后一条作为游标
    const lastItem = items.length > 0 ? items[items.length - 1] : null;
    const nextCursorCreatedAt = lastItem?.createdAt ?? null;
    const nextCursorId = lastItem?.id ?? null;

    return {
      items,
      total,
      nextCursorCreatedAt,
      nextCursorId,
    };
  }

  /**
   * 从查询参数中构建分页游标。
   * cursorCreatedAt 和 cursorId 必须同时提供才有效。
   */
  private buildCursor(
    query: ListClubRecordsQueryDto,
  ): { createdAt: Date; id: string } | undefined {
    if (query.cursorCreatedAt && query.cursorId) {
      return {
        createdAt: new Date(query.cursorCreatedAt),
        id: query.cursorId,
      };
    }
    return undefined;
  }
}
