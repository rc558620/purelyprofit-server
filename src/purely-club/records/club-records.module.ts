import { Module } from '@nestjs/common';
import { AuthModule } from '../../purely-profit/auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ClubStoresModule } from '../stores/club-stores.module';
import { ClubRecordsController } from './club-records.controller';
import { ClubRecordsService } from './club-records.service';

@Module({
  imports: [AuthModule, PrismaModule, ClubStoresModule],
  controllers: [ClubRecordsController],
  providers: [ClubRecordsService],
})
export class ClubRecordsModule {}
