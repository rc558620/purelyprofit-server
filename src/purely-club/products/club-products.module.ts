import { Module } from '@nestjs/common';
import { AuthModule } from '../../purely-profit/auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ClubStoresModule } from '../stores/club-stores.module';
import { ClubProductPromotionService } from './club-product-promotion.service';
import { ClubProductQueryService } from './club-product-query.service';
import { ClubProductViewService } from './club-product-view.service';
import { ClubProductsController } from './club-products.controller';
import { ClubProductsService } from './club-products.service';

@Module({
  imports: [AuthModule, PrismaModule, ClubStoresModule],
  controllers: [ClubProductsController],
  providers: [
    ClubProductPromotionService,
    ClubProductQueryService,
    ClubProductViewService,
    ClubProductsService,
  ],
  exports: [ClubProductsService],
})
export class ClubProductsModule {}
