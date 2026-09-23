// 新用户额度模块：对外提供额度服务，供营销中心、C 端绑定链路与会员购买链路复用
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { NewCustomerQuotaService } from './new-customer-quota.service';

@Module({
  imports: [PrismaModule],
  providers: [NewCustomerQuotaService],
  exports: [NewCustomerQuotaService],
})
export class NewCustomerQuotaModule {}
