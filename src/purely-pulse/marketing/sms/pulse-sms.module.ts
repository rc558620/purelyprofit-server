import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { SmsModule } from '../../../purely-profit/marketing/sms/sms.module';
import { PulseMembershipModule } from '../../membership/membership.module';
import { PulseSmsController } from './pulse-sms.controller';
import { PulseSmsService } from './pulse-sms.service';
import { PulseSmsWalletLogsService } from './pulse-sms-wallet-logs.service';

/**
 * Pulse 群发短信模块（平台运营视角）。
 *
 * 依赖说明：
 * - PulseMembershipModule：复用 `PulseMembershipAccessService` 的门店可见性口径，
 *   与新客额度管理完全一致（开发者看全部商家、非开发者只看自己的店）。
 * - SmsModule：复用 `SmsAccountService` 解析单价 / 预警阈值 / 充值档位，
 *   避免运营侧与商家侧两套配置漂移。
 * - 本模块**不碰微信支付链路**：赠送是平台自有资源，不涉及资金流。
 */
@Module({
  imports: [PrismaModule, PulseMembershipModule, SmsModule],
  controllers: [PulseSmsController],
  providers: [PulseSmsService, PulseSmsWalletLogsService],
})
export class PulseSmsModule {}
