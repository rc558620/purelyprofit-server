import { Module } from '@nestjs/common';
import { CommerceModule } from '../../commerce/commerce.module';
import { PlatformMembershipModule } from '../../member/platform-membership/platform-membership.module';
import { StoresModule } from '../../stores/stores.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { ProductsScanOrderingSyncService } from './products-scan-ordering-sync.service';

@Module({
  imports: [
    PrismaModule,
    CommerceModule,
    PlatformMembershipModule,
    StoresModule,
  ],
  controllers: [ProductsController],
  providers: [ProductsService, ProductsScanOrderingSyncService],
  exports: [ProductsService],
})
export class ProductsModule {}
