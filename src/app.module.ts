import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AccessControlModule } from './purely-profit/access-control/access-control.module';
import { AuthModule } from './purely-profit/auth/auth.module';
import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { EmployeesModule } from './purely-profit/staff/employees/employees.module';
import { MembersModule } from './purely-profit/member/members/members.module';
import { StoresModule } from './purely-profit/stores/stores.module';
import { StaffModule } from './purely-profit/staff/seats/staff.module';
import { SubscriptionsModule } from './purely-profit/subscriptions/subscriptions.module';
import { PlatformMembershipModule } from './purely-profit/member/platform-membership/platform-membership.module';
import { WithdrawalsModule } from './purely-profit/member/withdrawals/withdrawals.module';
import { BusinessAnalysisModule } from './purely-profit/dashboard/business-analysis/business-analysis.module';
import { CategoriesModule } from './purely-profit/goods/categories/categories.module';
import { CostsModule } from './purely-profit/operations/costs/costs.module';
import { FinanceModule } from './purely-profit/finance/finance.module';
import { InventoryModule } from './purely-profit/goods/inventory/inventory.module';
import { MarketingModule } from './purely-profit/marketing/marketing.module';
import { ProductsModule } from './purely-profit/goods/products/products.module';
import { PurchasesModule } from './purely-profit/operations/purchases/purchases.module';
import { SuppliersModule } from './purely-profit/operations/suppliers/suppliers.module';
import { ProfitDetailModule } from './purely-profit/dashboard/profit-detail/profit-detail.module';
import { SalesRecordModule } from './purely-profit/operations/sales-record/sales-record.module';
import { SpacesModule } from './purely-profit/operations/spaces/spaces.module';
import { DashboardHomeModule } from './purely-profit/dashboard/dashboard-home/dashboard-home.module';
import { HandoverModule } from './purely-profit/operations/handover/handover.module';
import { NotificationsModule } from './purely-profit/notifications/notifications.module';
import { PulseSessionModule } from './purely-pulse/session/session.module';
import { PulseOnboardingModule } from './purely-pulse/onboarding/onboarding.module';
import { PulseMembershipModule } from './purely-pulse/membership/membership.module';
import { PulseMembershipSettingsModule } from './purely-pulse/membership-settings/membership-settings.module';
import { PulseDashboardModule } from './purely-pulse/dashboard/dashboard.module';
import { PulseGrowthModule } from './purely-pulse/growth/growth.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: '.env',
    }),
    PrismaModule,
    RedisModule,
    AccessControlModule,
    AuthModule,
    EmployeesModule,
    MembersModule,
    StoresModule,
    StaffModule,
    SubscriptionsModule,
    PlatformMembershipModule,
    WithdrawalsModule,
    BusinessAnalysisModule,
    CostsModule,
    FinanceModule,
    MarketingModule,
    CategoriesModule,
    ProductsModule,
    SuppliersModule,
    PurchasesModule,
    InventoryModule,
    ProfitDetailModule,
    SalesRecordModule,
    SpacesModule,
    DashboardHomeModule,
    HandoverModule,
    NotificationsModule,
    PulseSessionModule,
    PulseOnboardingModule,
    PulseMembershipModule,
    PulseMembershipSettingsModule,
    PulseDashboardModule,
    PulseGrowthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
