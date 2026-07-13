import { Module } from '@nestjs/common';
import { AuthModule } from '../../purely-profit/auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ClubMemberModule } from '../member/club-member.module';
import { ClubStoresModule } from '../stores/club-stores.module';
import { ClubProductPromotionService } from './club-product-promotion.service';
import { ClubProductQueryService } from './club-product-query.service';
import { ClubProductViewService } from './club-product-view.service';
import { ClubProductsController } from './club-products.controller';
import { ClubProductsService } from './club-products.service';
import { ClubPromotionRepository } from '../shared/club-promotion.repository';

@Module({
  imports: [AuthModule, PrismaModule, ClubStoresModule, ClubMemberModule],
  controllers: [ClubProductsController],
  providers: [
    ClubProductPromotionService,
    ClubProductQueryService,
    ClubProductViewService,
    ClubProductsService,
    ClubPromotionRepository,
  ],
  exports: [ClubProductsService],
})
export class ClubProductsModule {}
