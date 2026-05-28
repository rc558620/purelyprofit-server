import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type {
  ListSalesProductsQueryDto,
  ListSalesRecordsQueryDto,
  SalesProductResponseDto,
  SalesRecordListResponseDto,
  SalesReportQueryDto,
  SalesReportResponseDto,
  SalesStatsQueryDto,
  SalesStatsResponseDto,
} from './dto/sales-record.dto';
import { SalesRecordListService } from './sales-record-list.service';
import { SalesRecordProductsService } from './sales-record-products.service';
import { SalesRecordReportService } from './sales-record-report.service';
import { SalesRecordStatsService } from './sales-record-stats.service';

@Injectable()
export class SalesRecordReadService {
  constructor(
    private readonly salesRecordProductsService: SalesRecordProductsService,
    private readonly salesRecordListService: SalesRecordListService,
    private readonly salesRecordStatsService: SalesRecordStatsService,
    private readonly salesRecordReportService: SalesRecordReportService,
  ) {}

  listProducts(
    user: AuthenticatedUser,
    query: ListSalesProductsQueryDto,
  ): Promise<SalesProductResponseDto[]> {
    return this.salesRecordProductsService.listProducts(user, query);
  }

  list(
    user: AuthenticatedUser,
    query: ListSalesRecordsQueryDto,
  ): Promise<SalesRecordListResponseDto> {
    return this.salesRecordListService.list(user, query);
  }

  listFrontendOrders(
    user: AuthenticatedUser,
    query: ListSalesRecordsQueryDto,
  ): Promise<SalesRecordListResponseDto> {
    return this.salesRecordListService.listFrontendOrders(user, query);
  }

  getStats(
    user: AuthenticatedUser,
    query: SalesStatsQueryDto,
  ): Promise<SalesStatsResponseDto> {
    return this.salesRecordStatsService.getStats(user, query);
  }

  getReport(
    user: AuthenticatedUser,
    query: SalesReportQueryDto,
  ): Promise<SalesReportResponseDto> {
    return this.salesRecordReportService.getReport(user, query);
  }
}
