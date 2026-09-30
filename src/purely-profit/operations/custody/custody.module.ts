// 客存模块：装配 B 端 controller 与读 / 写 / 核销 / 配置子服务
// 实时推送出口与取出核验策略单独成件，避免子服务超长
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { CustodyCodeModule } from '../../../shared/custody/custody-code.module';
import { CommerceModule } from '../../commerce/commerce.module';
import { ClubCustodyModule } from '../../../purely-club/custody/club-custody.module';
import {
  CustodyController,
  CustodyPickupController,
  CustodySettingsController,
} from './custody.controller';
import { CustodyPickupVerifyService } from './custody-pickup-verify.service';
import { CustodyPickupService } from './custody-pickup.service';
import { CustodyRealtimePublisher } from './custody-realtime.publisher';
import { CustodyReadService } from './custody-read.service';
import { CustodySettingsService } from './custody-settings.service';
import { CustodyService } from './custody.service';
import { CustodyWriteService } from './custody-write.service';

@Module({
  imports: [PrismaModule, CommerceModule, CustodyCodeModule, ClubCustodyModule],
  controllers: [
    CustodyController,
    CustodyPickupController,
    CustodySettingsController,
  ],
  providers: [
    CustodyReadService,
    CustodyWriteService,
    CustodyPickupService,
    CustodyPickupVerifyService,
    CustodyRealtimePublisher,
    CustodySettingsService,
    CustodyService,
  ],
  exports: [CustodyService, CustodyReadService],
})
export class CustodyModule {}
