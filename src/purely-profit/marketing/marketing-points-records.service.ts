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
} from './marketing.query';
import { MarketingSharedService } from './marketing-shared.service';
import {
  buildMarketingPaginationMeta,
  resolveMarketingPagination,
} from './marketing.utils';

@Injectable()
export class MarketingPointsRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly marketingSharedService: MarketingSharedService,
  ) {}

  async listPointsRecords(
    user: AuthenticatedUser,
    query: ListPointsRecordsQueryDto & { storeId?: number },
  ): Promise<MarketingPointsRecordsResponseDto> {
    const resolvedStoreId =
      await this.marketingSharedService.resolveMembershipManagedStoreId(
        user,
        query.storeId,
      );
    if (!resolvedStoreId) {
      return {
        items: [],
        meta: buildMarketingPaginationMeta(0, 1, query.pageSize ?? 20),
      };
    }

    const { page, skip, take } = resolveMarketingPagination(
      query.page,
      query.pageSize,
    );
    const listQuery = {
      storeId: resolvedStoreId,
      customerId: query.customerId,
      type: query.type,
      startMs: query.startMs,
      endMs: query.endMs,
    };

    const { items: rows, total } = await queryPointsRecordPage(this.prisma, {
      ...listQuery,
      skip,
      take,
    });

    return {
      items: rows.map(mapPointsRecordRow),
      meta: buildMarketingPaginationMeta(total, page, take),
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

    const { page, skip, take } = resolveMarketingPagination(
      query.page,
      query.pageSize,
    );
    const listQuery = {
      type: query.type,
      startMs: query.startMs,
      endMs: query.endMs,
    };

    const { items: rows, total } = await queryCustomerPointsRecordPage(
      this.prisma,
      customerId,
      { ...listQuery, skip, take },
    );

    return {
      items: rows.map(mapPointsRecordRow),
      meta: buildMarketingPaginationMeta(total, page, take),
    };
  }
}
