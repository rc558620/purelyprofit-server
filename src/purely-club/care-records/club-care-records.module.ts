import { Module } from '@nestjs/common';
import { AuthModule } from '../../purely-profit/auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ClubMemberModule } from '../member/club-member.module';
import { ClubStoresModule } from '../stores/club-stores.module';
import { ClubCareRecordsController } from './club-care-records.controller';
import { ClubCareRecordsService } from './club-care-records.service';

@Module({
  imports: [AuthModule, PrismaModule, ClubStoresModule, ClubMemberModule],
  controllers: [ClubCareRecordsController],
  providers: [ClubCareRecordsService],
  exports: [ClubCareRecordsService],
})
export class ClubCareRecordsModule {}
