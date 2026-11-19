import { Injectable } from '@nestjs/common';
import type {
  HandoverRecordListItemDto,
  HandoverRecordSummaryDto,
} from './dto/handover-records.dto';
import { HandoverRecordOperatorProfileService } from './handover-record-operator-profile.service';
import type { RecordOrderItemsPaging } from './handover-records-revenue.query';
import { HandoverRecordsRevenueService } from './handover-records-revenue.service';
import { HandoverRecordsViewContextService } from './handover-records-view-context.service';
import {
  buildRecordSummaryDto,
  formatShiftTimeDesc,
  mapRecordAdditionalItems,
  resolveShiftLabel,
  toDisplayName,
  type HandoverRecordRow,
  type HandoverRecordShiftRow,
} from './handover.shared';

@Injectable()
export class HandoverRecordsDetailService {
  constructor(
    private readonly handoverRecordsViewContextService: HandoverRecordsViewContextService,
    private readonly handoverRecordsRevenueService: HandoverRecordsRevenueService,
  ) {}

  /**
   * 批量版本：批量预加载所有 record 的 shift/employee 数据，
   * 并用 countRecordRevenueBatch 一次性下推 N 个 shiftRange 做 3 次聚合查询，
   * DB 往返从 3N 降为 3（viewContext 预加载另计）。
   */
  async buildRecordSummaryBatch(
    storeId: number,
    records: readonly HandoverRecordShiftRow[],
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
    /** 订单明细分页：不传则取默认首页（limit=ORDER_ITEMS_LIMIT, offset=0） */
    orderItemsPaging?: RecordOrderItemsPaging,
  ): Promise<
    Pick<
      HandoverRecordListItemDto,
      | 'shiftInfo'
      | 'additionalItems'
      | 'revenueSummary'
      | 'paymentItems'
      | 'orderItems'
      | 'orderItemsTotal'
      | 'receiverName'
    >
  > {
    const shiftContext =
      await this.handoverRecordsViewContextService.resolveRecordShiftContext(
        storeId,
        record,
      );
    const operatorName =
      HandoverRecordOperatorProfileService.resolveOperatorName(
        record,
        shiftContext.shiftRecord,
      );

    // 营收聚合只依赖 shiftRange；头像要查 employee → linkedStaff → user 三层。
    // 两者并行，详情路径少等一轮头像查询。
    const [operatorProf, revenueDetail] = await Promise.all([
      this.handoverRecordsViewContextService.resolveOperatorProfile(
        record,
        shiftContext.shiftRecord,
      ),
      this.handoverRecordsRevenueService.buildRecordRevenueDetail(
        storeId,
        shiftContext.shiftRange,
        // 当班操作员：扫码点餐订单无实际操作员时回退展示
        operatorName,
        orderItemsPaging,
      ),
    ]);

    return {
      shiftInfo: {
        operatorName,
        ...(operatorProf.avatar
          ? {
              operatorAvatar: operatorProf.avatar,
              avatar: operatorProf.avatar,
            }
          : {}),
        shiftType: shiftContext.shiftRecord?.shiftType ?? null,
        shiftLabel: resolveShiftLabel(
          shiftContext.shiftRecord?.shiftType,
          shiftContext.shiftRecord?.shiftName,
        ),
        startTime: shiftContext.shiftRecord?.startTime ?? null,
        endTime: shiftContext.shiftRecord?.endTime ?? null,
        timeDesc: formatShiftTimeDesc(
          shiftContext.shiftRecord?.date ?? shiftContext.referenceDate,
          shiftContext.shiftRecord?.startTime,
          shiftContext.shiftRecord?.endTime,
        ),
        shiftReferenceAt: shiftContext.shiftStartAt.getTime(),
      },
      additionalItems: mapRecordAdditionalItems(record),
      revenueSummary: revenueDetail.revenueSummary,
      paymentItems: revenueDetail.paymentItems,
      orderItems: revenueDetail.orderItems,
      orderItemsTotal: revenueDetail.orderItemsTotal,
      receiverName: toDisplayName(record.toEmployee?.name) ?? '',
    };
  }
}
