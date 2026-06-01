import { Module } from '@nestjs/common';
import { PlatformMembershipModule } from '../../member/platform-membership/platform-membership.module';
import { HandoverController } from './handover.controller';
import { HandoverAdditionalItemsService } from './handover-additional-items.service';
import { HandoverConfirmService } from './handover-confirm.service';
import { HandoverPageService } from './handover-page.service';
import { HandoverRecordsService } from './handover-records.service';
import { HandoverService } from './handover.service';

@Module({
  imports: [PlatformMembershipModule],
  controllers: [HandoverController],
  providers: [
    HandoverService,
    HandoverPageService,
    HandoverConfirmService,
    HandoverRecordsService,
    HandoverAdditionalItemsService,
  ],
  exports: [HandoverService],
})
export class HandoverModule {}
