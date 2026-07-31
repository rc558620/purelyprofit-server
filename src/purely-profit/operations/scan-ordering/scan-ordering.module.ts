import { Module } from '@nestjs/common';
import { CommerceModule } from '../../commerce/commerce.module';
import { StoresModule } from '../../stores/stores.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { RedisModule } from '../../../redis/redis.module';
import { ClubScanOrderingModule } from '../../../purely-club/scan-ordering/club-scan-ordering.module';
import { ClubServiceCallModule } from '../../../purely-club/service-call/club-service-call.module';
import { ScanOrderingMainController } from './scan-ordering.controller';
import { ScanOrderingOrderController } from './scan-ordering-orders.controller';
import { ScanOrderingTableController } from './scan-ordering-table.controller';
import { ScanOrderingAreaService } from './scan-ordering-area.service';
import { ScanOrderingTypeService } from './scan-ordering-type.service';
import { ScanOrderingDashboardService } from './scan-ordering-dashboard.service';
import { ScanOrderingPricingService } from './scan-ordering-pricing.service';
import { ScanOrderingQrService } from './scan-ordering-qr.service';
import { ScanOrderingTableService } from './scan-ordering-table.service';
import { ScanOrderingOrderService } from './scan-ordering-order.service';
import { ScanOrderingOrderRefundHandlingService } from './scan-ordering-order-refund.service';
import { ScanOrderingOrderStateMachineService } from './scan-ordering-order-machine.service';
import { ScanOrderingOrderTransitionEngineService } from './scan-ordering-order-transition.service';
import { ScanOrderingServiceCallService } from './scan-ordering-service-call.service';
import { ScanOrderingMenuService } from './scan-ordering-menu.service';
import { ScanOrderingMenuCategoryService } from './scan-ordering-menu-category.service';
import { ScanOrderingMenuProductService } from './scan-ordering-menu-product.service';
import { ScanOrderingMenuSpecService } from './scan-ordering-menu-spec.service';
import { ScanOrderingMenuStockService } from './scan-ordering-menu-stock.service';
import { ScanOrderingMenuQueryService } from './scan-ordering-menu-query.service';
import { ScanOrderingSessionArchiveService } from './scan-ordering-session-archive.service';

/** 扫码点餐领域模块：商家管理、消费者点餐、订单与支付共享同一领域规则。 */
@Module({
  imports: [
    PrismaModule,
    CommerceModule,
    RedisModule,
    StoresModule,
    ClubScanOrderingModule,
    ClubServiceCallModule,
  ],
  controllers: [
    ScanOrderingMainController,
    ScanOrderingOrderController,
    ScanOrderingTableController,
  ],
  providers: [
    ScanOrderingAreaService,
    ScanOrderingTypeService,
    ScanOrderingDashboardService,
    ScanOrderingPricingService,
    ScanOrderingQrService,
    ScanOrderingTableService,
    ScanOrderingOrderService,
    ScanOrderingOrderRefundHandlingService,
    ScanOrderingOrderTransitionEngineService,
    ScanOrderingOrderStateMachineService,
    ScanOrderingServiceCallService,
    // Menu services
    ScanOrderingMenuCategoryService,
    ScanOrderingMenuProductService,
    ScanOrderingMenuSpecService,
    ScanOrderingMenuStockService,
    ScanOrderingMenuQueryService,
    ScanOrderingMenuService,
    ScanOrderingSessionArchiveService,
  ],
  exports: [ScanOrderingPricingService, ScanOrderingSessionArchiveService],
})
export class ScanOrderingModule {}
