import { Injectable } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type {
  CostRecordStatsQueryDto,
  CostReportQueryDto,
  ListCostRecordsQueryDto,
} from './dto/costs-query.dto';
import type {
  CostDashboardResponseDto,
  CostRecordResponseDto,
  CostReportResponseDto,
  CostStatsResponseDto,
} from './dto/costs-response.dto';
import { CostsReadRecordsService } from './costs-read-records.service';
import { CostsReadStatsService } from './costs-read-stats.service';
import { CostsReadReportService } from './costs-read-report.service';
import { CostsReadDashboardService } from './costs-read-dashboard.service';

@Injectable()
export class CostsReadService {
  constructor(
    private readonly records: CostsReadRecordsService,
    private readonly stats: CostsReadStatsService,
    private readonly report: CostsReadReportService,
    private readonly dashboard: CostsReadDashboardService,
  ) {}

  listRecords(
    user: AuthenticatedUser,
    query: ListCostRecordsQueryDto,
  ): Promise<CostRecordResponseDto[]> {
    return this.records.listRecords(user, query);
  }

  getStats(
    user: AuthenticatedUser,
    query: CostRecordStatsQueryDto,
  ): Promise<CostStatsResponseDto> {
    return this.stats.getStats(user, query);
  }

  getReport(
    user: AuthenticatedUser,
    query: CostReportQueryDto,
  ): Promise<CostReportResponseDto> {
    return this.report.getReport(user, query);
  }

  getDashboard(
    user: AuthenticatedUser,
    query: CostRecordStatsQueryDto,
  ): Promise<CostDashboardResponseDto> {
    return this.dashboard.getDashboard(user, query);
  }

  streamReportCsv(
    reply: ServerResponse,
    user: AuthenticatedUser,
    query: CostReportQueryDto,
  ): Promise<void> {
    return this.report.streamReportCsv(reply, user, query);
  }

  /**
   * 预热成本统计缓存（供 CachePrewarmCycleService 调用）
   */
  warmStatsCache(
    storeId: number,
    query: Pick<
      CostRecordStatsQueryDto,
      'period' | 'typeFilter' | 'customDate' | 'rangeStartDate' | 'rangeEndDate'
    >,
  ): Promise<CostStatsResponseDto> {
    return this.stats.warmStatsCache(storeId, query);
  }

  /**
   * 预热成本报表缓存（供 CachePrewarmCycleService 调用）
   */
  warmReportCache(
    storeId: number,
    query: Pick<
      CostReportQueryDto,
      | 'period'
      | 'year'
      | 'customDate'
      | 'rangeStartDate'
      | 'rangeEndDate'
      | 'categoryFilter'
    >,
  ): Promise<CostReportResponseDto> {
    return this.report.warmReportCache(storeId, query);
  }
}
