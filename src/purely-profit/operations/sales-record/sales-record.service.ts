import { Injectable } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type {
  CreateSalesRecordDto,
  ListSalesProductsQueryDto,
  ListSalesRecordsQueryDto,
  PreviewSalesRecordResponseDto,
  SalesProductResponseDto,
  SalesRecordListResponseDto,
  SalesRecordResponseDto,
  SalesReportQueryDto,
  SalesReportResponseDto,
  SalesStatsQueryDto,
  SalesStatsResponseDto,
} from './dto/sales-record.dto';
import { SalesRecordPreviewService } from './sales-record-preview.service';
import { SalesRecordReadService } from './sales-record-read.service';
import type { CreateSalesRecordOptions } from './sales-record-item-preparation.service';
import { SalesRecordWriteService } from './sales-record-write.service';

@Injectable()
export class SalesRecordService {
  constructor(
    private readonly salesRecordReadService: SalesRecordReadService,
    private readonly salesRecordWriteService: SalesRecordWriteService,
    private readonly salesRecordPreviewService: SalesRecordPreviewService,
  ) {}

  preview(dto: CreateSalesRecordDto): PreviewSalesRecordResponseDto {
    return this.salesRecordPreviewService.preview(dto);
  }

  listProducts(
    user: AuthenticatedUser,
    query: ListSalesProductsQueryDto,
  ): Promise<SalesProductResponseDto[]> {
    return this.salesRecordReadService.listProducts(user, query);
  }

  list(
    user: AuthenticatedUser,
    query: ListSalesRecordsQueryDto,
  ): Promise<SalesRecordListResponseDto> {
    return this.salesRecordReadService.list(user, query);
  }

  listFrontendOrders(
    user: AuthenticatedUser,
    query: ListSalesRecordsQueryDto,
  ): Promise<SalesRecordListResponseDto> {
    return this.salesRecordReadService.listFrontendOrders(user, query);
  }

  getStats(
    user: AuthenticatedUser,
    query: SalesStatsQueryDto,
  ): Promise<SalesStatsResponseDto> {
    return this.salesRecordReadService.getStats(user, query);
  }

  getReport(
    user: AuthenticatedUser,
    query: SalesReportQueryDto,
  ): Promise<SalesReportResponseDto> {
    return this.salesRecordReadService.getReport(user, query);
  }

  streamReportCsv(
    reply: ServerResponse,
    user: AuthenticatedUser,
    query: SalesReportQueryDto,
  ): Promise<void> {
    return this.salesRecordReadService.streamReportCsv(reply, user, query);
  }

  create(
    user: AuthenticatedUser,
    dto: CreateSalesRecordDto,
    options: CreateSalesRecordOptions = {},
  ): Promise<SalesRecordResponseDto> {
    return this.salesRecordWriteService.create(user, dto, options);
  }

  remove(user: AuthenticatedUser, salesRecordId: number): Promise<void> {
    return this.salesRecordWriteService.remove(user, salesRecordId);
  }
}
