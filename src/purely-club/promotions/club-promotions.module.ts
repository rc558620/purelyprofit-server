import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../../purely-profit/auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ClubStoresModule } from '../stores/club-stores.module';
import { ClubPromotionsController } from './club-promotions.controller';
import { ClubPromotionsService } from './club-promotions.service';

@Module({
  imports: [forwardRef(() => AuthModule), PrismaModule, ClubStoresModule],
  controllers: [ClubPromotionsController],
  providers: [ClubPromotionsService],
  exports: [ClubPromotionsService],
})
export class ClubPromotionsModule {}
