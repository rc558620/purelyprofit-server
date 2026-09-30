// 客存 C 端模块：依赖门店上下文、Redis 短码与 Prisma
// 同时承载客存实时网关与分发服务（B 端客存模块直接复用同一实例，
// 避免 /custody 命名空间被重复注册）
import { Module } from '@nestjs/common';
import { AuthModule } from '../../purely-profit/auth/auth.module';
import { CommerceModule } from '../../purely-profit/commerce/commerce.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { RedisModule } from '../../redis/redis.module';
import { CustodyCodeModule } from '../../shared/custody/custody-code.module';
import { ClubStoresModule } from '../stores/club-stores.module';
import { ClubCustodyController } from './club-custody.controller';
import { ClubCustodyReadService } from './club-custody-read.service';
import { ClubCustodyService } from './club-custody.service';
import { ClubCustodyWriteService } from './club-custody-write.service';
import { CustodyGateway } from './custody.gateway';
import { CustodyRealtimeService } from './custody-realtime.service';

@Module({
  imports: [
    AuthModule,
    CommerceModule,
    PrismaModule,
    RedisModule,
    CustodyCodeModule,
    ClubStoresModule,
  ],
  controllers: [ClubCustodyController],
  providers: [
    ClubCustodyReadService,
    ClubCustodyWriteService,
    ClubCustodyService,
    CustodyRealtimeService,
    CustodyGateway,
  ],
  exports: [ClubCustodyService, CustodyRealtimeService],
})
export class ClubCustodyModule {}
