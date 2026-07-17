import type { ConfigService } from '@nestjs/config';
import { resolvePagination } from '../../commerce/commerce.utils';
import type { ListSpaceSessionsQueryDto } from './dto/space-session.dto';
import type { SpaceSessionListQuery } from './space-sessions.types';

/**
 * 空间会话完整 include select 定义，供所有读取会话的方法复用，
 * 避免 getActiveSpaceSession / listSpaceSessions / getSpaceSessionDetail /
 * listStoreSpaceSessionsByQuery 四处维护相同的 select 字段。
 */
export const SPACE_SESSION_FULL_INCLUDE = {
  space: {
    select: {
      id: true,
      name: true,
      type: {
        select: {
          name: true,
        },
      },
    },
  },
  sessionItems: {
    select: {
      id: true,
      sessionId: true,
      productId: true,
      productName: true,
      categoryName: true,
      salePrice: true,
      profit: true,
      quantity: true,
      sortOrder: true,
      createdAt: true,
    },
  },
  sessionRenewRecords: {
    select: {
      id: true,
      sessionId: true,
      recordId: true,
      amount: true,
      addedMinutes: true,
      paymentMethod: true,
      grouponCode: true,
      grouponPlatform: true,
      voucherFaceAmount: true,
      note: true,
      renewedAt: true,
      createdAt: true,
    },
  },
} as const;

export const toSpaceSessionListQuery = (
  query: ListSpaceSessionsQueryDto,
): SpaceSessionListQuery => ({
  page: query.page,
  pageSize: query.pageSize,
  status: query.status,
  includeActive: query.includeActive,
  keyword: query.keyword,
  guestName: query.guestName,
  guestPhone: query.guestPhone,
  spaceName: query.spaceName,
  rangeStartDate: query.rangeStartDate,
  rangeEndDate: query.rangeEndDate,
});

export const resolveSpaceSessionPageQuery = (
  configService: ConfigService,
  page?: number,
  pageSize?: number,
) => {
  const defaultPageSize =
    configService.get<number>('app.defaultPageSize') ?? 20;
  const maxPageSize = configService.get<number>('app.maxPageSize') ?? 100;

  return resolvePagination(page, pageSize, defaultPageSize, maxPageSize);
};
