// 录入订单落库服务：事务内创建 ScanOrders 主记录、明细行与规格快照、状态历史、取餐号，
// 并生成手工补录单订单号（金额由 pricing 服务权威提供，本服务只做持久化与快照）

import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  ScanOrderFulfillmentStatus,
  ScanOrderPaymentStatus,
  ScanOrderStatus,
} from '@prisma/client';
import { getShanghaiDayStartMs } from '../../../../shared/shanghai-time.utils';
import { ScanOrderingPickupNumberService } from '../../../../purely-club/scan-ordering/scan-ordering-pickup-number.service';
import { ManualEntryIdempotencyService } from './manual-entry-idempotency.service';
import type {
  ManualEntryAmounts,
  ManualEntryPricedItem,
} from './manual-entry-pricing.service';
import type { CreateManualEntryOrderDto } from './dto/manual-entry.dto';

/** 落库入参：门店、操作人、表单、幂等键与服务端权威定价结果 */
export interface ManualEntryScanOrderWriteInput {
  /** 门店 ID */
  storeId: number;
  /** 操作人（商家账号）ID */
  actorId: number;
  /** 建单表单 */
  dto: CreateManualEntryOrderDto;
  /** 幂等键 */
  idempotencyKey: string;
  /** 定价后的明细行（分） */
  pricedItems: ManualEntryPricedItem[];
  /** 金额汇总（分） */
  amounts: ManualEntryAmounts;
}

/** 落库结果：后续写日志、推实时事件与返回响应所需字段 */
export interface ManualEntryWrittenScanOrder {
  /** ScanOrders ID */
  id: number;
  /** 乐观锁版本：实时事件要带上，商家端接单/拒单才不会因版本过旧 409 */
  version: number;
  /** 订单号（手工补录号段） */
  orderNo: string;
  /** 应付金额（分） */
  payableAmount: number;
  /** 创建时间 */
  createdAt: Date;
  /** 取餐号（自取/堂食可能分配） */
  pickupNumber: number | null;
  /** 取餐号展示文案 */
  pickupNumberLabel: string | null;
}

/**
 * 手工补录单落库服务。
 *
 * 订单一律落 ScanOrders 与扫码点餐同状态机：
 * - 订单状态：pending_acceptance（与扫码单「已支付待接单」同态）
 * - 支付状态：paid（线下已收款）
 * - 履约状态：preparing
 * - 不创建 SaleOrder（出餐时由 bridge 落库）
 */
@Injectable()
export class ManualEntryScanOrderWriter {
  constructor(
    private readonly pickupNumberService: ScanOrderingPickupNumberService,
    private readonly idempotencyService: ManualEntryIdempotencyService,
  ) {}

  /** 事务内创建 ScanOrders、明细行与规格快照、状态历史，并分配取餐号、标记幂等成功。 */
  async create(
    tx: Prisma.TransactionClient,
    input: ManualEntryScanOrderWriteInput,
  ): Promise<ManualEntryWrittenScanOrder> {
    const { storeId, actorId, dto, idempotencyKey, pricedItems, amounts } =
      input;
    const now = new Date();
    const orderNo = await this.generateManualEntryScanOrderNo(tx, storeId, now);

    // 创建 ScanOrders 主记录
    const scanOrder = await tx.scanOrders.create({
      data: {
        storeId,
        orderNo,
        tableId: dto.tableId ?? null,
        sessionId: null,
        clubUserId: null,
        diningRoundId: crypto.randomUUID(),
        guestCount: dto.guestCount ?? null,
        remark: dto.remark?.trim() ?? null,
        idempotencyKey,
        currency: 'CNY',
        itemOriginalAmount: amounts.itemsTotalCents,
        specificationExtraAmount: 0,
        productDiscountAmount: 0,
        orderDiscountAmount: amounts.discountCents,
        serviceFeeAmount: 0,
        taxAmount: 0,
        payableAmount: amounts.payableCents,
        paidAmount: amounts.payableCents,
        status: ScanOrderStatus.pending_acceptance,
        paymentStatus: ScanOrderPaymentStatus.paid,
        fulfillmentStatus: ScanOrderFulfillmentStatus.preparing,
        paidAt: now,
        manualEntry: true,
        manualEntryMetadata: buildManualEntryMetadata(dto),
      },
      select: {
        id: true,
        version: true,
        orderNo: true,
        payableAmount: true,
        createdAt: true,
      },
    });

    // 创建 ScanOrderItem + ScanOrderItemSpec 快照
    await this.createOrderItems(tx, storeId, scanOrder.id, pricedItems);

    // 记录状态历史
    await tx.scanOrderStatusHistory.create({
      data: {
        orderId: scanOrder.id,
        storeId,
        fromStatus: ScanOrderStatus.pending_acceptance,
        toStatus: ScanOrderStatus.pending_acceptance,
        operatorType: 'merchant',
        operatorId: actorId,
        reason: '商家录入订单（手工补录）',
      },
    });

    // 分配取餐号（自取/堂食订单需要取餐号供语音叫号）
    const pickup = await this.pickupNumberService.assignForPaidOrder(
      tx,
      scanOrder.id,
      storeId,
      now.getTime(),
    );

    // 幂等记录标记成功并关联 scan_order
    await this.idempotencyService.markSucceeded(tx, actorId, idempotencyKey, {
      orderId: scanOrder.id,
      orderNo: scanOrder.orderNo,
      payableAmountCents: scanOrder.payableAmount,
      createdAt: scanOrder.createdAt,
    });

    return {
      id: scanOrder.id,
      version: scanOrder.version,
      orderNo: scanOrder.orderNo,
      payableAmount: scanOrder.payableAmount,
      createdAt: scanOrder.createdAt,
      pickupNumber: pickup?.pickupNumber ?? null,
      pickupNumberLabel: pickup?.pickupNumberLabel ?? null,
    };
  }

  /** 批量创建 ScanOrderItem + ScanOrderItemSpec 快照（规格签名不参与唯一约束）。 */
  private async createOrderItems(
    tx: Prisma.TransactionClient,
    storeId: number,
    orderId: number,
    pricedItems: ManualEntryPricedItem[],
  ): Promise<void> {
    for (const item of pricedItems) {
      await tx.scanOrderItem.create({
        data: {
          orderId,
          storeId,
          menuProductId: item.menuProductId,
          productNameSnapshot: item.productName,
          productImageUrlSnapshot: null,
          categoryNameSnapshot: item.categoryName,
          specSignature: '',
          quantity: item.quantity,
          basePriceSnapshot: item.basePriceCents,
          unitPriceAmount: item.unitPriceCents,
          discountAmount: 0,
          lineTotalAmount: item.lineTotalCents,
          payableLineAmount: item.lineTotalCents,
          sortOrder: 0,
          specs: {
            create: item.specOptionIds.map((specOptionId, index) => ({
              specOptionId,
              specOptionNameSnapshot: item.specNames[index] ?? '',
              extraPriceSnapshot: 0,
            })),
          },
        },
        select: { id: true },
      });
    }
  }

  /**
   * 生成手工补录单订单号：#M-YYYYMMDD-NNN（与 sale_orders 手工单同号段）。
   * 基于 pg_advisory_xact_lock 保证同门店同日期串行、不跳号。
   */
  private async generateManualEntryScanOrderNo(
    tx: Prisma.TransactionClient,
    storeId: number,
    date: Date,
  ): Promise<string> {
    const dateStr = new Date(getShanghaiDayStartMs(date.getTime()))
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, '');
    const key = Number(dateStr);
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(${storeId}, ${key})
    `;
    const dayStart = new Date(getShanghaiDayStartMs(date.getTime()));
    const dayEnd = new Date(
      getShanghaiDayStartMs(date.getTime()) + 24 * 60 * 60 * 1000,
    );
    const count = await tx.scanOrders.count({
      where: {
        storeId,
        manualEntry: true,
        createdAt: { gte: dayStart, lt: dayEnd },
      },
    });
    return `#M-${dateStr}-${String(count + 1).padStart(3, '0')}`;
  }
}

/** 构建 manualEntryMetadata 快照：就餐方式与支付方式必填，其余字段有值才写入。 */
const buildManualEntryMetadata = (
  dto: CreateManualEntryOrderDto,
): Prisma.InputJsonValue => {
  const metadata: Record<string, unknown> = {
    diningMode:
      dto.diningMode === 'platform' && dto.isSelfPickup
        ? 'takeaway'
        : dto.diningMode,
    paymentMethod: dto.paymentMethod,
  };
  if (dto.sourceChannel) metadata.sourceChannel = dto.sourceChannel;
  if (dto.externalOrderNo)
    metadata.externalOrderNo = dto.externalOrderNo.trim();
  if (dto.grouponCode) metadata.grouponCode = dto.grouponCode.trim();
  if (dto.guestCount !== undefined) metadata.guestCount = dto.guestCount;
  if (dto.customerPhone) metadata.customerPhone = dto.customerPhone.trim();
  if (dto.voucherAmount !== undefined)
    metadata.voucherAmount = dto.voucherAmount;
  return metadata as Prisma.InputJsonValue;
};
