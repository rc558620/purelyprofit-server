import { Module, forwardRef } from '@nestjs/common';
import { PlatformMembershipModule } from '../../member/platform-membership/platform-membership.module';
import { SpacesModule } from '../spaces/spaces.module';
import { HandoverController } from './handover.controller';
import { HandoverAdditionalItemsService } from './handover-additional-items.service';
import { HandoverConfirmShiftService } from './handover-confirm-shift.service';
import { HandoverConfirmService } from './handover-confirm.service';
import { HandoverPageService } from './handover-page.service';
import { HandoverPageShiftRecordService } from './handover-page-shift-record.service';
import { HandoverPageShiftSelectorService } from './handover-page-shift-selector.service';
import { HandoverPageShiftService } from './handover-page-shift.service';
import { HandoverPageShiftViewService } from './handover-page-shift-view.service';
import { HandoverRecordsDetailService } from './handover-records-detail.service';
import { HandoverRecordsQueryService } from './handover-records-query.service';
import { HandoverRecordsRevenueService } from './handover-records-revenue.service';
import { HandoverRecordsService } from './handover-records.service';
import { HandoverRecordsViewContextService } from './handover-records-view-context.service';
import { HandoverService } from './handover.service';

@Module({
  imports: [PlatformMembershipModule, forwardRef(() => SpacesModule)],
  controllers: [HandoverController],
  providers: [
    HandoverService,
    HandoverPageService,
    HandoverPageShiftRecordService,
    HandoverPageShiftSelectorService,
    HandoverPageShiftService,
    HandoverPageShiftViewService,
    HandoverConfirmShiftService,
    HandoverConfirmService,
    HandoverRecordsService,
    HandoverRecordsQueryService,
    HandoverRecordsDetailService,
    HandoverRecordsRevenueService,
    HandoverRecordsViewContextService,
    HandoverAdditionalItemsService,
  ],
  exports: [HandoverService, HandoverPageShiftRecordService],
})
export class HandoverModule {}
