import { Injectable } from '@nestjs/common';
import type {
  HandoverRecordListItemDto,
  HandoverRecordSummaryDto,
} from './dto/handover-records.dto';
import { HandoverRecordsRevenueService } from './handover-records-revenue.service';
import { HandoverRecordsViewContextService } from './handover-records-view-context.service';
import {
  buildRecordSummaryDto,
  formatShiftTimeDesc,
  mapRecordAdditionalItems,
  resolveShiftLabel,
  toDisplayName,
  type HandoverRecordRow,
} from './handover.shared';

@Injectable()
export class HandoverRecordsDetailService {
  constructor(
    private readonly handoverRecordsViewContextService: HandoverRecordsViewContextService,
    private readonly handoverRecordsRevenueService: HandoverRecordsRevenueService,
  ) {}

  async buildRecordSummary(
    storeId: number,
    record: HandoverRecordRow,
  ): Promise<HandoverRecordSummaryDto> {
    const context =
      await this.handoverRecordsViewContextService.resolveRecordViewContext(
        storeId,
        record,
      );
    const totalRevenue =
      await this.handoverRecordsRevenueService.countRecordRevenue(
        storeId,
        context.shiftRange,
        context.operatorStaffId,
      );

    return buildRecordSummaryDto({
      id: record.id,
      operatorName: context.operatorName,
      shiftType: context.shiftRecord?.shiftType ?? null,
      shiftLabel: resolveShiftLabel(
        context.shiftRecord?.shiftType,
        context.shiftRecord?.shiftName,
      ),
      startTime: context.shiftRecord?.startTime ?? null,
      endTime: context.shiftRecord?.endTime ?? null,
      totalRevenue,
      operatorAvatar: context.operatorAvatar,
      status: record.status,
      handoverAt: record.handoverAt,
      createdAt: record.createdAt,
    });
  }

  async buildRecordDetail(
    storeId: number,
    record: HandoverRecordRow,
  ): Promise<
    Pick<
      HandoverRecordListItemDto,
      | 'shiftInfo'
      | 'additionalItems'
      | 'revenueSummary'
      | 'paymentItems'
      | 'orderItems'
      | 'receiverName'
    >
  > {
    const context =
      await this.handoverRecordsViewContextService.resolveRecordViewContext(
        storeId,
        record,
      );
    const revenueDetail =
      await this.handoverRecordsRevenueService.buildRecordRevenueDetail(
        storeId,
        context.shiftRange,
        context.operatorStaffId,
      );

    return {
      shiftInfo: {
        operatorName: context.operatorName,
        ...(context.operatorAvatar
          ? {
              operatorAvatar: context.operatorAvatar,
              avatar: context.operatorAvatar,
            }
          : {}),
        shiftType: context.shiftRecord?.shiftType ?? null,
        shiftLabel: resolveShiftLabel(
          context.shiftRecord?.shiftType,
          context.shiftRecord?.shiftName,
        ),
        startTime: context.shiftRecord?.startTime ?? null,
        endTime: context.shiftRecord?.endTime ?? null,
        timeDesc: formatShiftTimeDesc(
          context.referenceDate,
          context.shiftRecord?.startTime,
          context.shiftRecord?.endTime,
        ),
      },
      additionalItems: mapRecordAdditionalItems(record),
      revenueSummary: revenueDetail.revenueSummary,
      paymentItems: revenueDetail.paymentItems,
      orderItems: revenueDetail.orderItems,
      receiverName: toDisplayName(record.toEmployee?.name) ?? '',
    };
  }
}
