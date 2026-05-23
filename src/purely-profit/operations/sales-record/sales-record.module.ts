import { Module } from '@nestjs/common';
import { CommerceModule } from '../../commerce/commerce.module';
import { InventoryModule } from '../../goods/inventory/inventory.module';
import { PlatformMembershipModule } from '../../member/platform-membership/platform-membership.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import {
  SalesOrdersCompatController,
  SalesRecordController,
} from './sales-record.controller';
import { SalesRecordService } from './sales-record.service';

@Module({
  imports: [PrismaModule, CommerceModule, InventoryModule, PlatformMembershipModule],
  controllers: [SalesRecordController, SalesOrdersCompatController],
  providers: [SalesRecordService],
  exports: [SalesRecordService],
})
export class SalesRecordModule {}
