import { Injectable } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import type { PermissionCode } from '../../access-control/access-control.constants';
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
    private readonly commerceAccessService: CommerceAccessService,
  ) {}

  /**
   * 预览金额（不落库）。
   *
   * 需要门店上下文：金额以商品目录价格为准（与 create 同源），
   * 因此必须先解析出 storeId 才能查目录。
   */
  async preview(
    user: AuthenticatedUser,
    dto: CreateSalesRecordDto,
    permission: PermissionCode,
    options: CreateSalesRecordOptions = {},
  ): Promise<PreviewSalesRecordResponseDto> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      dto.storeId,
      permission,
      '无权操作该门店销售记录',
    );

    return this.salesRecordPreviewService.preview(storeId, dto, options);
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
