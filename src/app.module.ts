import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AccessControlModule } from './access-control/access-control.module';
import { AuthModule } from './auth/auth.module';
import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { EmployeesModule } from './staff/employees/employees.module';
import { MembersModule } from './member/members/members.module';
import { StoresModule } from './stores/stores.module';
import { StaffModule } from './staff/seats/staff.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { PlatformMembershipModule } from './member/platform-membership/platform-membership.module';
import { WithdrawalsModule } from './member/withdrawals/withdrawals.module';
import { BusinessAnalysisModule } from './dashboard/business-analysis/business-analysis.module';
import { CategoriesModule } from './goods/categories/categories.module';
import { CostsModule } from './operations/costs/costs.module';
import { FinanceModule } from './finance/finance.module';
import { InventoryModule } from './goods/inventory/inventory.module';
import { MarketingModule } from './marketing/marketing.module';
import { ProductsModule } from './goods/products/products.module';
import { PurchasesModule } from './operations/purchases/purchases.module';
import { SuppliersModule } from './operations/suppliers/suppliers.module';
import { ProfitDetailModule } from './dashboard/profit-detail/profit-detail.module';
import { SalesRecordModule } from './operations/sales-record/sales-record.module';
import { SpacesModule } from './operations/spaces/spaces.module';
import { DashboardHomeModule } from './dashboard/dashboard-home/dashboard-home.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PulseSessionModule } from './pulse/session/session.module';
import { PulseOnboardingModule } from './pulse/onboarding/onboarding.module';
import { PulseMembershipModule } from './pulse/membership/membership.module';
import { PulseDashboardModule } from './pulse/dashboard/dashboard.module';
import { PulseGrowthModule } from './pulse/growth/growth.module';

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
    NotificationsModule,
    PulseSessionModule,
    PulseOnboardingModule,
    PulseMembershipModule,
    PulseDashboardModule,
    PulseGrowthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
