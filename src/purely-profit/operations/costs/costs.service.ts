import { Injectable } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import { type CostRecord, type Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type {
  CostRecordStatsQueryDto,
  CostReportQueryDto,
  CreateCostRecordDto,
  ListCostRecordsQueryDto,
} from './dto/costs-query.dto';
import type {
  CostRecordResponseDto,
  CostReportResponseDto,
  CostStatsResponseDto,
} from './dto/costs-response.dto';
import { CostsReadService } from './costs-read.service';
import { CostsWriteService } from './costs-write.service';
import type {
  SyncPayrollCostInput,
  SyncPurchaseCostInput,
} from './costs.types';

@Injectable()
export class CostsService {
  constructor(
    private readonly costsReadService: CostsReadService,
    private readonly costsWriteService: CostsWriteService,
  ) {}

  listRecords(
    user: AuthenticatedUser,
    query: ListCostRecordsQueryDto,
  ): Promise<CostRecordResponseDto[]> {
    return this.costsReadService.listRecords(user, query);
  }

  getStats(
    user: AuthenticatedUser,
    query: CostRecordStatsQueryDto,
  ): Promise<CostStatsResponseDto> {
    return this.costsReadService.getStats(user, query);
  }

  getReport(
    user: AuthenticatedUser,
    query: CostReportQueryDto,
  ): Promise<CostReportResponseDto> {
    return this.costsReadService.getReport(user, query);
  }

  streamReportCsv(
    reply: ServerResponse,
    user: AuthenticatedUser,
    query: CostReportQueryDto,
  ): Promise<void> {
    return this.costsReadService.streamReportCsv(reply, user, query);
  }

  createRecord(
    user: AuthenticatedUser,
    dto: CreateCostRecordDto,
  ): Promise<CostRecordResponseDto> {
    return this.costsWriteService.createRecord(user, dto);
  }

  deleteRecord(user: AuthenticatedUser, recordId: number): Promise<void> {
    return this.costsWriteService.deleteRecord(user, recordId);
  }

  deletePurchaseCostRecord(
    transaction: Prisma.TransactionClient,
    storeId: number,
    purchaseOrderId: number,
  ): Promise<void> {
    return this.costsWriteService.deletePurchaseCostRecord(
      transaction,
      storeId,
      purchaseOrderId,
    );
  }

  syncPurchaseCost(
    transaction: Prisma.TransactionClient,
    input: SyncPurchaseCostInput,
  ): Promise<CostRecord> {
    return this.costsWriteService.syncPurchaseCost(transaction, input);
  }

  syncPayrollCosts(
    transaction: Prisma.TransactionClient,
    input: SyncPayrollCostInput,
  ): Promise<void> {
    return this.costsWriteService.syncPayrollCosts(transaction, input);
  }
}
