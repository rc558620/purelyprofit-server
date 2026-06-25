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
      shiftDate: context.shiftRecord?.date,
    });
  }

  /**
   * 批量版本：批量预加载所有 record 的 shift/employee 数据后并行计算营收，
   * 避免每条 record 触发独立的 N 次数据库查询。
   * 营收计算（countRecordRevenue）依赖各自的 shiftRange，仍需并行执行，
   * 但 viewContext 预加载已从 O(N) DB 查询降为 O(1)。
   */
  async buildRecordSummaryBatch(
    storeId: number,
    records: HandoverRecordRow[],
  ): Promise<HandoverRecordSummaryDto[]> {
    if (records.length === 0) {
      return [];
    }

    // 一次批量预加载所有 record 的视图上下文
    const contexts =
      await this.handoverRecordsViewContextService.resolveRecordViewContextBatch(
        storeId,
        records,
      );

    // 营收计算仍需并行（各 record 的 shiftRange 不同）
    return Promise.all(
      records.map(async (record, i) => {
        const context = contexts[i];
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
          shiftDate: context.shiftRecord?.date,
        });
      }),
    );
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
          context.shiftRecord?.date ?? context.referenceDate,
          context.shiftRecord?.startTime,
          context.shiftRecord?.endTime,
        ),
        shiftReferenceAt: context.shiftRange.startAt.getTime(),
      },
      additionalItems: mapRecordAdditionalItems(record),
      revenueSummary: revenueDetail.revenueSummary,
      paymentItems: revenueDetail.paymentItems,
      orderItems: revenueDetail.orderItems,
      receiverName: toDisplayName(record.toEmployee?.name) ?? '',
    };
  }
}
