import { Injectable } from '@nestjs/common';
import type { ClubCurrentContext } from '../../stores/club-stores.types';
import { ClubRecordsService } from '../../records/club-records.service';
import type {
  ClubMemberTransactionDto,
  ClubMemberTransactionsResponseDto,
  ListClubMemberTransactionsQueryDto,
} from './dto/club-member-transaction.dto';

@Injectable()
export class ClubMemberTransactionsService {
  constructor(private readonly clubRecordsService: ClubRecordsService) {}

  async list(
    currentContext: ClubCurrentContext,
    query: ListClubMemberTransactionsQueryDto,
  ): Promise<ClubMemberTransactionsResponseDto> {
    const result = await this.clubRecordsService.list(currentContext, {
      type: query.type,
      limit: query.limit,
      cursor: query.cursor,
    });

    return {
      items: result.items.map((item) => this.toTransactionDto(item)),
      // 本接口不暴露 withTotal，流水查询始终统计总数（null 只出现在主动跳过 count 的翻页场景）
      total: result.total ?? 0,
      nextCursor: result.nextCursor,
    };
  }

  private toTransactionDto(item: {
    id: string;
    type: ClubMemberTransactionDto['type'];
    amount: number;
    description: string;
    createdAt: string;
    balanceSnapshot: number;
    storeName?: string;
  }): ClubMemberTransactionDto {
    return {
      id: item.id,
      type: item.type,
      amount: item.amount,
      description: item.description,
      createdAt: item.createdAt,
      balanceSnapshot: item.balanceSnapshot,
      ...(item.storeName ? { storeName: item.storeName } : {}),
    };
  }
}
