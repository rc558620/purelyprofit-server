import type { ConfigService } from '@nestjs/config';
import { resolvePagination } from '../../commerce/commerce.utils';
import type { ListSpaceSessionsQueryDto } from './dto/space-session.dto';
import type { SpaceSessionListQuery } from './space-sessions.types';

export const toSpaceSessionListQuery = (
  query: ListSpaceSessionsQueryDto,
): SpaceSessionListQuery => ({
  page: query.page,
  pageSize: query.pageSize,
  status: query.status,
  includeActive: query.includeActive,
  keyword: query.keyword,
  rangeStartDate: query.rangeStartDate,
  rangeEndDate: query.rangeEndDate,
});

export const resolveSpaceSessionPageQuery = (
  configService: ConfigService,
  page?: number,
  pageSize?: number,
) => {
  const defaultPageSize = configService.get<number>('app.defaultPageSize') ?? 20;
  const maxPageSize = configService.get<number>('app.maxPageSize') ?? 100;

  return resolvePagination(page, pageSize, defaultPageSize, maxPageSize);
};
