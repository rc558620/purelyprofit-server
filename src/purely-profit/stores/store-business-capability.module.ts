import { Module } from '@nestjs/common';
import { StoreBusinessCapabilityService } from './store-business-capability.service';
import { BusinessModeGuard } from './business-mode.guard';

/**
 * 门店业态能力模块。
 *
 * 独立于 StoresModule 和 AuthModule，避免循环依赖。
 * 作为门店业态能力的唯一事实来源，供 AuthModule 和其他模块注入。
 */
@Module({
  providers: [StoreBusinessCapabilityService, BusinessModeGuard],
  exports: [StoreBusinessCapabilityService, BusinessModeGuard],
})
export class StoreBusinessCapabilityModule {}
