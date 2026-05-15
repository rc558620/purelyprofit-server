import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AccessControlModule } from './access-control/access-control.module';
import { AuthModule } from './auth/auth.module';
import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { EmployeesModule } from './employees/employees.module';
import { MembersModule } from './members/members.module';
import { StoresModule } from './stores/stores.module';
import { StaffModule } from './staff/staff.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { PlatformMembershipModule } from './platform-membership/platform-membership.module';
import { WithdrawalsModule } from './withdrawals/withdrawals.module';
import { BusinessAnalysisModule } from './business-analysis/business-analysis.module';
import { CategoriesModule } from './categories/categories.module';
import { CostsModule } from './costs/costs.module';
import { FinanceModule } from './finance/finance.module';
import { InventoryModule } from './inventory/inventory.module';
import { MarketingModule } from './marketing/marketing.module';
import { ProductsModule } from './products/products.module';
import { PurchasesModule } from './purchases/purchases.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { ProfitDetailModule } from './profit-detail/profit-detail.module';
import { SalesRecordModule } from './sales-record/sales-record.module';
import { SpacesModule } from './spaces/spaces.module';
import { DashboardHomeModule } from './dashboard-home/dashboard-home.module';
import { NotificationsModule } from './notifications/notifications.module';

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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
