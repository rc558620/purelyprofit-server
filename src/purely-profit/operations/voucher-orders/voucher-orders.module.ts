// 商家端团购券订单管理模块：列表/确认/拒绝 + 新订单语音播报开关（复用 Club 退款链路与扫码点餐实时服务）
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { CommerceModule } from '../../commerce/commerce.module';
import { StoresModule } from '../../stores/stores.module';
import { ClubVoucherOrdersModule } from '../../../purely-club/voucher-orders/club-voucher-orders.module';
import { ClubScanOrderingModule } from '../../../purely-club/scan-ordering/club-scan-ordering.module';
import { VoucherOrdersController } from './voucher-orders.controller';
import { VoucherOrdersService } from './voucher-orders.service';
import { VoucherOrderVoiceSettingsService } from './voucher-order-voice-settings.service';

@Module({
  imports: [
    PrismaModule,
    // 商家端门店权限解析（CommerceAccessService）
    CommerceModule,
    // 业态守卫依赖（StoreBusinessCapabilityService / BusinessModeGuard）
    StoresModule,
    // 商家端拒绝接单复用退款核心链路（ClubVoucherOrderRefundService）
    ClubVoucherOrdersModule,
    // 确认/拒绝/新订单事件广播（ScanOrderingRealtimeService）
    ClubScanOrderingModule,
  ],
  controllers: [VoucherOrdersController],
  providers: [VoucherOrdersService, VoucherOrderVoiceSettingsService],
})
export class VoucherOrdersModule {}
