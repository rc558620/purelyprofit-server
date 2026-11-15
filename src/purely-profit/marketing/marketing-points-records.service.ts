import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  ListCustomerPointsRecordsQueryDto,
  ListPointsRecordsQueryDto,
} from './dto/marketing-query.dto';
import type { MarketingPointsRecordsResponseDto } from './dto/marketing-response.dto';
import { mapPointsRecordRow } from './marketing.mapper';
import {
  queryCustomerPointsRecordPage,
  queryPointsRecordPage,
} from './marketing-flow.query';
import {
  buildMarketingFlowPage,
  resolveMarketingFlowPaging,
} from './marketing-flow.cursor';
import { MarketingSharedService } from './marketing-shared.service';
import { buildMarketingPaginationMeta } from './marketing.utils';

@Injectable()
export class MarketingPointsRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly marketingSharedService: MarketingSharedService,
  ) {}

  async listPointsRecords(
    user: AuthenticatedUser,
    query: ListPointsRecordsQueryDto,
  ): Promise<MarketingPointsRecordsResponseDto> {
    const resolvedStoreId =
      await this.marketingSharedService.resolveMembershipManagedStoreId(
        user,
        query.storeId,
      );
    // 分页参数归一放在取数之前：cursor 非法时直接 400，不白跑一次列表查询
    const paging = resolveMarketingFlowPaging(query);
    if (!resolvedStoreId) {
      return {
        items: [],
        meta: buildMarketingPaginationMeta(0, 1, paging.limit),
        hasMore: false,
        nextCursor: null,
      };
    }

    const { items: rows, total } = await queryPointsRecordPage(this.prisma, {
      storeId: resolvedStoreId,
      customerId: query.customerId,
      type: query.type,
      startMs: query.startMs,
      endMs: query.endMs,
      skip: paging.offset,
      // 游标路径多取一行做「是否还有下一页」探测；offset 路径取数成本不变
      take: paging.cursor ? paging.limit + 1 : paging.limit,
      cursor: paging.cursor,
    });
    const page = buildMarketingFlowPage(rows, total, paging);

    return {
      items: page.rows.map(mapPointsRecordRow),
      meta: page.meta,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  }

  async listCustomerPointsRecords(
    user: AuthenticatedUser,
    customerId: number,
    query: ListCustomerPointsRecordsQueryDto,
  ): Promise<MarketingPointsRecordsResponseDto> {
    const customer =
      await this.marketingSharedService.findCustomerOrThrow(customerId);
    await this.marketingSharedService.ensureMarketingStoreAccess(
      user,
      customer.storeId,
      'marketing:view',
    );

    const paging = resolveMarketingFlowPaging(query);
    const { items: rows, total } = await queryCustomerPointsRecordPage(
      this.prisma,
      customerId,
      {
        type: query.type,
        startMs: query.startMs,
        endMs: query.endMs,
        skip: paging.offset,
        take: paging.limit,
      },
    );
    const page = buildMarketingFlowPage(rows, total, paging);

    return {
      items: page.rows.map(mapPointsRecordRow),
      meta: page.meta,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  }
}
