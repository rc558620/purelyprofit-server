import { Module } from '@nestjs/common';
import { ClubMemberModule } from '../member/club-member.module';
import { ClubProductsModule } from '../products/club-products.module';
import { ClubPromotionsModule } from '../promotions/club-promotions.module';
import { ClubStoresModule } from '../stores/club-stores.module';
import { ClubHomeController } from './club-home.controller';
import { ClubHomeService } from './club-home.service';

@Module({
  imports: [
    ClubStoresModule,
    ClubMemberModule,
    ClubPromotionsModule,
    ClubProductsModule,
  ],
  controllers: [ClubHomeController],
  providers: [ClubHomeService],
})
export class ClubHomeModule {}
