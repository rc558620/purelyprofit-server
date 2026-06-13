import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../../purely-profit/auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ClubStoresModule } from '../stores/club-stores.module';
import { ClubRecordQueryService } from './club-record-query.service';
import { ClubRecordViewService } from './club-record-view.service';
import { ClubRecordsController } from './club-records.controller';
import { ClubRecordsService } from './club-records.service';

@Module({
  imports: [forwardRef(() => AuthModule), PrismaModule, ClubStoresModule],
  controllers: [ClubRecordsController],
  providers: [
    ClubRecordQueryService,
    ClubRecordViewService,
    ClubRecordsService,
  ],
  exports: [ClubRecordsService],
})
export class ClubRecordsModule {}
