import { Module } from '@nestjs/common';
import { PlatformMembershipModule } from '../../member/platform-membership/platform-membership.module';
import { SpacesModule } from '../spaces/spaces.module';
import { HandoverShiftModule } from './handover-shift.module';
import { HandoverController } from './handover.controller';
import { HandoverAdditionalItemsService } from './handover-additional-items.service';
import { HandoverConfirmShiftFallbackService } from './handover-confirm-shift-fallback.service';
import { HandoverConfirmShiftService } from './handover-confirm-shift.service';
import { HandoverConfirmService } from './handover-confirm.service';
import { HandoverPageService } from './handover-page.service';
import { HandoverPageShiftSelectorService } from './handover-page-shift-selector.service';
import { HandoverPageShiftService } from './handover-page-shift.service';
import { HandoverPageShiftViewService } from './handover-page-shift-view.service';
import { HandoverRecordsDetailService } from './handover-records-detail.service';
import { HandoverRecordsQueryService } from './handover-records-query.service';
import { HandoverRecordsRevenueService } from './handover-records-revenue.service';
import { HandoverRecordsService } from './handover-records.service';
import { HandoverRecordsViewContextService } from './handover-records-view-context.service';
import { HandoverRecordBatchPreloaderService } from './handover-record-batch-preloader.service';
import { HandoverRecordOperatorProfileService } from './handover-record-operator-profile.service';
import { HandoverService } from './handover.service';

@Module({
  imports: [PlatformMembershipModule, SpacesModule, HandoverShiftModule],
  controllers: [HandoverController],
  providers: [
    HandoverService,
    HandoverPageService,
    HandoverPageShiftSelectorService,
    HandoverPageShiftService,
    HandoverPageShiftViewService,
    HandoverConfirmShiftFallbackService,
    HandoverConfirmShiftService,
    HandoverConfirmService,
    HandoverRecordsService,
    HandoverRecordsQueryService,
    HandoverRecordsDetailService,
    HandoverRecordsRevenueService,
    HandoverRecordsViewContextService,
    HandoverRecordBatchPreloaderService,
    HandoverRecordOperatorProfileService,
    HandoverAdditionalItemsService,
  ],
  exports: [HandoverService, HandoverShiftModule],
})
export class HandoverModule {}
