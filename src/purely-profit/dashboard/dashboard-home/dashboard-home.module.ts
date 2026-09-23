import { Module } from '@nestjs/common';
import { CommerceModule } from '../../commerce/commerce.module';
import { NewCustomerQuotaModule } from '../../member/new-customer-quota/new-customer-quota.module';
import { PlatformMembershipModule } from '../../member/platform-membership/platform-membership.module';
import { DashboardHomeController } from './dashboard-home.controller';
import { DashboardHomeService } from './dashboard-home.service';

@Module({
  imports: [CommerceModule, PlatformMembershipModule, NewCustomerQuotaModule],
  controllers: [DashboardHomeController],
  providers: [DashboardHomeService],
  exports: [DashboardHomeService],
})
export class DashboardHomeModule {}
