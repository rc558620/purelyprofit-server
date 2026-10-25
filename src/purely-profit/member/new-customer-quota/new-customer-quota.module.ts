// 新用户额度模块：对外提供额度服务，供营销中心、C 端绑定链路与会员购买链路复用
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ProfitPaymentsModule } from '../../payments/profit-payments.module';
import { NewCustomerQuotaRechargeService } from './new-customer-quota-recharge.service';
import { NewCustomerQuotaService } from './new-customer-quota.service';

@Module({
  // ProfitPaymentsModule 提供支付单与平台下单能力（该模块不反向依赖业务模块）
  imports: [PrismaModule, ProfitPaymentsModule],
  providers: [NewCustomerQuotaService, NewCustomerQuotaRechargeService],
  exports: [NewCustomerQuotaService, NewCustomerQuotaRechargeService],
})
export class NewCustomerQuotaModule {}
