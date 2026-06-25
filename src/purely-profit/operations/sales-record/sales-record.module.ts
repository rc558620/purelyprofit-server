import { Module } from '@nestjs/common';
import { CommerceModule } from '../../commerce/commerce.module';
import { InventoryModule } from '../../goods/inventory/inventory.module';
import { PlatformMembershipModule } from '../../member/platform-membership/platform-membership.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { HandoverShiftModule } from '../handover/handover-shift.module';
import {
  SalesOrdersCompatController,
  SalesRecordController,
} from './sales-record.controller';
import { SalesRecordCreateFlowService } from './sales-record-create-flow.service';
import { SalesRecordItemPreparationService } from './sales-record-item-preparation.service';
import { SalesRecordListService } from './sales-record-list.service';
import { SalesRecordProductsService } from './sales-record-products.service';
import { SalesRecordReadService } from './sales-record-read.service';
import { SalesRecordReportService } from './sales-record-report.service';
import { SalesRecordService } from './sales-record.service';
import { SalesRecordStatsService } from './sales-record-stats.service';
import { SalesRecordWriteService } from './sales-record-write.service';

@Module({
  imports: [
    PrismaModule,
    CommerceModule,
    InventoryModule,
    PlatformMembershipModule,
    HandoverShiftModule,
  ],
  controllers: [SalesRecordController, SalesOrdersCompatController],
  providers: [
    SalesRecordItemPreparationService,
    SalesRecordCreateFlowService,
    SalesRecordProductsService,
    SalesRecordListService,
    SalesRecordStatsService,
    SalesRecordReportService,
    SalesRecordReadService,
    SalesRecordWriteService,
    SalesRecordService,
  ],
  exports: [SalesRecordService],
})
export class SalesRecordModule {}
