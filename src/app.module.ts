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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
