import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  ListSalesRecordsQueryDto,
  SalesRecordListResponseDto,
} from './dto/sales-record.dto';
import { buildPaginationMeta, resolvePagination } from '../../commerce/commerce.utils';
import { mapSalesRecordResponse } from './sales-record.domain';
import { countSaleOrders, querySaleOrders } from './sales-record.query';
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
    private readonly configService: ConfigService,
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

    const { page, skip, take } = this.resolvePagination(
      query.page,
      query.pageSize,
    );

    if (storeId === null) {
      return buildEmptySalesListResponse(page, take);
    }

    const range = await this.platformMembershipAccessService.clampHistoryRange(
      storeId,
      buildSalesCurrentRange(query),
    );
    if (range.empty) {
      return buildEmptySalesListResponse(page, take);
    }

    const [orders, total] = await Promise.all([
      querySaleOrders(this.prisma, {
        storeId,
        range: { start: range.start, end: range.end },
        skip,
        take,
      }),
      countSaleOrders(this.prisma, {
        storeId,
        range: { start: range.start, end: range.end },
      }),
    ]);
    const items = orders.map((order) => mapSalesRecordResponse(order));

    return {
      items,
      meta: buildPaginationMeta(total, page, take),
    };
  }

  listFrontendOrders(
    user: AuthenticatedUser,
    query: ListSalesRecordsQueryDto,
  ): Promise<SalesRecordListResponseDto> {
    return this.list(user, {
      ...query,
      period: query.period ?? 'all',
    });
  }

  private resolvePagination(page?: number, pageSize?: number) {
    const defaultPageSize =
      this.configService.get<number>('app.defaultPageSize') ?? 20;
    const maxPageSize = this.configService.get<number>('app.maxPageSize') ?? 100;

    return resolvePagination(page, pageSize, defaultPageSize, maxPageSize);
  }
}
