import { Module } from '@nestjs/common';
import { AuthModule } from '../../purely-profit/auth/auth.module';
import { ClubMemberModule } from '../member/club-member.module';
import { ClubProductsModule } from '../products/club-products.module';
import { ClubPromotionsModule } from '../promotions/club-promotions.module';
import { ClubStoresModule } from '../stores/club-stores.module';
import { ClubHomeController } from './club-home.controller';
import { ClubHomeService } from './club-home.service';

@Module({
  imports: [
    AuthModule,
    ClubStoresModule,
    ClubMemberModule,
    ClubPromotionsModule,
    ClubProductsModule,
  ],
  controllers: [ClubHomeController],
  providers: [ClubHomeService],
})
export class ClubHomeModule {}
