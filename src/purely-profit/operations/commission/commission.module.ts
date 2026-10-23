import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { CommerceModule } from '../../commerce/commerce.module';
// 业态门控：技师提成仅非餐饮门店可用（BusinessModeGuard 由本模块导出）
import { StoreBusinessCapabilityModule } from '../../stores/store-business-capability.module';
import { CommissionCoreService } from './commission-core.service';
import { CommissionRecordsController } from './commission-records.controller';
import { CommissionRecordsService } from './commission-records.service';
import { CommissionServicesController } from './commission-services.controller';
import { CommissionServicesService } from './commission-services.service';

@Module({
  imports: [PrismaModule, CommerceModule, StoreBusinessCapabilityModule],
  controllers: [CommissionServicesController, CommissionRecordsController],
  providers: [
    CommissionCoreService,
    CommissionServicesService,
    CommissionRecordsService,
  ],
  exports: [CommissionCoreService],
})
export class CommissionModule {}
