import type { DashboardHomeCapabilitySnapshot } from './dashboard-home.capability.service';
import { filterDashboardHomeActivitiesByModules } from './dashboard-home.activities-visibility';
import type { DashboardHomeOverviewWithoutCapability } from './dashboard-home.mapper';
import type { DashboardHomeOverviewResponseDto } from './dto/dashboard-home-response.dto';

/**
 * 按当前登录身份裁剪响应。
 *
 * 概览缓存是门店级共享的，命中与回源两条路径都必须走这里，保证「同一份缓存、
 * 不同角色看到不同动态」。缓存写入本身不做裁剪（见 composeAndCacheOverview）。
 */
export function applyCapabilityToOverview(
  overview: DashboardHomeOverviewWithoutCapability,
  capability: DashboardHomeCapabilitySnapshot,
): DashboardHomeOverviewResponseDto {
  return {
    ...overview,
    activities: filterDashboardHomeActivitiesByModules(
      overview.activities,
      capability.allowedHomeModules,
    ),
    capability,
  };
}
