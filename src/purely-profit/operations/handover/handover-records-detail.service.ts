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
   * 批量版本：批量预加载所有 record 的 shift/employee 数据，
   * 并用 countRecordRevenueBatch 一次性下推 N 个 shiftRange 做 3 次聚合查询，
   * DB 往返从 3N 降为 3（viewContext 预加载另计）。
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

    // 批量计算营收：3 次 raw SQL 替代 N×3 次 Prisma aggregate
    const totalRevenues =
      await this.handoverRecordsRevenueService.countRecordRevenueBatch(
        storeId,
        contexts.map((c) => c.shiftRange),
      );

    return records.map((record, i) => {
      const context = contexts[i];
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
        totalRevenue: totalRevenues[i],
        operatorAvatar: context.operatorAvatar,
        status: record.status,
        handoverAt: record.handoverAt,
        createdAt: record.createdAt,
        shiftDate: context.shiftRecord?.date,
      });
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
        // 当班操作员：扫码点餐订单无实际操作员时回退展示
        context.operatorName,
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
