import { Module } from '@nestjs/common';
import { AuthModule } from '../../purely-profit/auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ClubStoresModule } from '../stores/club-stores.module';
import { ClubProductsController } from './club-products.controller';
import { ClubProductsService } from './club-products.service';

@Module({
  imports: [AuthModule, PrismaModule, ClubStoresModule],
  controllers: [ClubProductsController],
  providers: [ClubProductsService],
})
export class ClubProductsModule {}
