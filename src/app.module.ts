import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import Redis from 'ioredis';
import { buildRedisConnectionOptions } from './shared/redis-connection.utils';
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
import { ScanOrderingModule } from './purely-profit/operations/scan-ordering/scan-ordering.module';
import { DashboardHomeModule } from './purely-profit/dashboard/dashboard-home/dashboard-home.module';
import { HandoverModule } from './purely-profit/operations/handover/handover.module';
import { NotificationsModule } from './purely-profit/notifications/notifications.module';
import { PulseSessionModule } from './purely-pulse/session/session.module';
import { PulseOnboardingModule } from './purely-pulse/onboarding/onboarding.module';
import { PulseMembershipModule } from './purely-pulse/membership/membership.module';
import { PulseMembershipSettingsModule } from './purely-pulse/membership-settings/membership-settings.module';
import { PulseDashboardModule } from './purely-pulse/dashboard/dashboard.module';
import { ClientErrorsModule } from './purely-profit/client-errors/client-errors.module';
import { PulseGrowthModule } from './purely-pulse/growth/growth.module';
import { PulseAuthModule } from './purely-pulse/auth/pulse-auth.module';
import { ClubAuthModule } from './purely-club/auth/club-auth.module';
import { ClubHomeModule } from './purely-club/home/club-home.module';
import { ClubMemberModule } from './purely-club/member/club-member.module';
import { ClubOrdersModule } from './purely-club/orders/club-orders.module';
import { ClubPaymentsModule } from './purely-club/payments/club-payments.module';
import { ClubProductsModule } from './purely-club/products/club-products.module';
import { ClubPromotionsModule } from './purely-club/promotions/club-promotions.module';
import { ClubRechargeModule } from './purely-club/recharge/club-recharge.module';
import { ClubRecordsModule } from './purely-club/records/club-records.module';
import { ClubPointsModule } from './purely-club/points/club-points.module';
import { ClubStoresModule } from './purely-club/stores/club-stores.module';
import { ClubScanOrderingModule } from './purely-club/scan-ordering/club-scan-ordering.module';
import { PulseDevModeModule } from './purely-pulse/dev-mode/pulse-dev-mode.module';
import { QueueModule } from './queue/queue.module';
import { CacheControlInterceptor } from './shared/cache-control.interceptor';
import { ResponseSanitizerInterceptor } from './shared/response-sanitizer.interceptor';
import { AuditLogModule } from './shared/audit-log.module';
import { UploadModule } from './shared/upload.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: '.env',
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redisOptions = buildRedisConnectionOptions(configService);
        const redisClient = new Redis(redisOptions);

        return {
          throttlers: [
            {
              name: 'default',
              ttl: configService.get<number>('app.throttleTtlSeconds') ?? 60,
              limit: configService.get<number>('app.throttleLimit') ?? 100,
            },
          ],
          /**
           * 使用 Redis 存储：集群模式下所有 worker 共享同一限流计数器，
           * 确保同一 IP 在整个集群中的请求频率受到正确限制。
           * 默认内存存储下各 worker 独立计数，实际限流倍数 = worker 数 × limit。
           */
          storage: new ThrottlerStorageRedisService(redisClient),
        };
      },
    }),
    PrismaModule,
    AuditLogModule,
    UploadModule,
    RedisModule,
    QueueModule,
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
    ScanOrderingModule,
    DashboardHomeModule,
    HandoverModule,
    NotificationsModule,
    ClientErrorsModule,
    PulseSessionModule,
    PulseOnboardingModule,
    PulseMembershipModule,
    PulseMembershipSettingsModule,
    PulseDashboardModule,
    PulseGrowthModule,
    PulseAuthModule,
    ClubAuthModule,
    ClubHomeModule,
    ClubMemberModule,
    ClubOrdersModule,
    ClubPaymentsModule,
    ClubProductsModule,
    ClubPromotionsModule,
    ClubRechargeModule,
    ClubRecordsModule,
    ClubPointsModule,
    ClubStoresModule,
    ClubScanOrderingModule,
    PulseDevModeModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    /**
     * 全局限流守卫：默认同一 IP 60 秒内最多 100 次请求。
     * auth 相关接口在各自 controller 中通过 @Throttle 覆盖为更严格的配置。
     */
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    /**
     * 全局 Cache-Control 响应头拦截器。
     * 仅对标注了 @CacheControl() 装饰器的接口添加 Cache-Control 头，
     * 用于指导客户端缓存纯读接口的响应，减少不必要的回源请求。
     */
    { provide: APP_INTERCEPTOR, useClass: CacheControlInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseSanitizerInterceptor },
  ],
})
export class AppModule {}
