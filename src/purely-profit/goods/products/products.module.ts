import { Module } from '@nestjs/common';
import { CommerceModule } from '../../commerce/commerce.module';
import { PlatformMembershipModule } from '../../member/platform-membership/platform-membership.module';
import { StoresModule } from '../../stores/stores.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { ProductsScanOrderingSyncService } from './products-scan-ordering-sync.service';
import { ProductSpecPricingService } from './product-spec-pricing.service';

@Module({
  imports: [
    PrismaModule,
    CommerceModule,
    PlatformMembershipModule,
    StoresModule,
  ],
  controllers: [ProductsController],
  providers: [
    ProductsService,
    ProductsScanOrderingSyncService,
    ProductSpecPricingService,
  ],
  exports: [ProductsService, ProductSpecPricingService],
})
export class ProductsModule {}
