import type { GetDashboardHomeOverviewQueryDto } from './dto/dashboard-home-query.dto';
import type { DashboardHomeQueryInput } from './dashboard-home.types';

export function buildDashboardHomeQueryInput(
  queryDto: GetDashboardHomeOverviewQueryDto,
): DashboardHomeQueryInput {
  return {
    storeId: queryDto.storeId,
    period: queryDto.period,
  };
}
