import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  ListSalesRecordsQueryDto,
  SalesRecordListResponseDto,
  SalesRecordResponseDto,
} from './dto/sales-record.dto';
import { mapSalesRecordResponse } from './sales-record.domain';
import { querySaleOrders } from './sales-record.query';
import {
  buildEmptySalesListResponse,
  buildSalesCurrentRange,
} from './sales-record-read.utils';

@Injectable()
export class SalesRecordListService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly platformMembershipAccessService: PlatformMembershipAccessService,
  ) {}

  async list(
    user: AuthenticatedUser,
    query: ListSalesRecordsQueryDto,
  ): Promise<SalesRecordListResponseDto> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      query.storeId,
      'sales:view',
      '无权查看该门店销售记录',
    );

    if (storeId === null) {
      return buildEmptySalesListResponse();
    }

    const range = await this.platformMembershipAccessService.clampHistoryRange(
      storeId,
      buildSalesCurrentRange(query),
    );
    if (range.empty) {
      return buildEmptySalesListResponse();
    }

    const orders = await querySaleOrders(this.prisma, {
      storeId,
      range: { start: range.start, end: range.end },
    });
    const items = orders.map((order) => mapSalesRecordResponse(order));

    return {
      items,
      meta: {
        page: 1,
        pageSize: Math.max(items.length, 1),
        total: items.length,
        totalPages: items.length === 0 ? 0 : 1,
      },
    };
  }

  async listFrontendOrders(
    user: AuthenticatedUser,
    query: ListSalesRecordsQueryDto,
  ): Promise<SalesRecordResponseDto[]> {
    const response = await this.list(user, {
      ...query,
      period: query.period ?? 'all',
    });

    return response.items;
  }
}
