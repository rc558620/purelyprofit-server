// 录入订单模块装配：菜单聚合、定价、库存扣减与建单服务

import { Module } from '@nestjs/common';
import { CommerceModule } from '../../../commerce/commerce.module';
import { StoreBusinessCapabilityModule } from '../../../stores/store-business-capability.module';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { RedisModule } from '../../../../redis/redis.module';
import { ClubScanOrderingModule } from '../../../../purely-club/scan-ordering/club-scan-ordering.module';
import { ManualEntryController } from './manual-entry.controller';
import { ManualEntryMenuService } from './manual-entry-menu.service';
import { ManualEntryOrderDetailService } from './manual-entry-order-detail.service';
import { ManualEntryOrderService } from './manual-entry-order.service';
import { ManualEntryPricingService } from './manual-entry-pricing.service';
import { ManualEntryStockService } from './manual-entry-stock.service';

/** 录入订单（手工补录）领域模块。 */
@Module({
  imports: [
    PrismaModule,
    CommerceModule,
    ClubScanOrderingModule,
    RedisModule,
    StoreBusinessCapabilityModule,
  ],
  controllers: [ManualEntryController],
  providers: [
    ManualEntryMenuService,
    ManualEntryOrderService,
    ManualEntryOrderDetailService,
    ManualEntryPricingService,
    ManualEntryStockService,
  ],
  exports: [ManualEntryOrderDetailService],
})
export class ManualEntryModule {}
