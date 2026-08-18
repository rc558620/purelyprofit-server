// 录入订单建单服务：幂等控制、表单校验、库存预留与 ScanOrders 建单的事务编排
//（金额全部服务端权威计算，出餐时才由 bridge 落 SaleOrder）

import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  ScanOrderFulfillmentStatus,
  ScanOrderPaymentStatus,
  ScanOrderStatus,
} from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { Money } from '../../../../shared/money.utils';
import { getShanghaiDayStartMs } from '../../../../shared/shanghai-time.utils';
import { CommerceAccessService } from '../../../commerce/commerce-access.service';
import { CacheInvalidatorService } from '../../../../redis/invalidator';
import type { AuthenticatedUser } from '../../../auth/strategies/jwt.strategy';
import { ScanOrderingRealtimeService } from '../../../../purely-club/scan-ordering/scan-ordering-realtime.service';
import { ScanOrderingPickupNumberService } from '../../../../purely-club/scan-ordering/scan-ordering-pickup-number.service';
import type { ManualEntryPricedItem } from './manual-entry-pricing.service';
import {
  ManualEntryPricingService,
  type ManualEntryAmounts,
} from './manual-entry-pricing.service';
import { ManualEntryStockService } from './manual-entry-stock.service';
import type {
  CreateManualEntryOrderDto,
  ManualEntryPreviewDto,
} from './dto/manual-entry.dto';
import type {
  ManualEntryOrderCreatedResponse,
  ManualEntryPreviewResponse,
} from './manual-entry.types';

/** 幂等记录作用域：商家端录入订单建单 */
const IDEMPOTENCY_SCOPE = 'profit:manual-entry:create';

/** 幂等记录保留时长：24 小时 */
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** 请求指纹：同一草稿重复提交时用于比对幂等记录 */
const hashManualEntryRequest = (payload: unknown): string =>
  createHash('sha256').update(JSON.stringify(payload)).digest('hex');

/** 录入订单建单与预览编排服务。 */
@Injectable()
export class ManualEntryOrderService {
  private readonly logger = new Logger(ManualEntryOrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly pricingService: ManualEntryPricingService,
    private readonly stockService: ManualEntryStockService,
    private readonly realtimeService: ScanOrderingRealtimeService,
    private readonly pickupNumberService: ScanOrderingPickupNumberService,
  ) {}

  /** 价格预览：定价 + 券面抵扣计算，全部服务端权威，前端只读展示。 */
  async preview(
    user: AuthenticatedUser,
    dto: ManualEntryPreviewDto,
  ): Promise<ManualEntryPreviewResponse> {
    const storeId = await this.resolveStoreId(user);
    const pricedItems = await this.pricingService.priceItems(
      storeId,
      dto.items,
    );
    const amounts = this.pricingService.calculateAmounts(
      pricedItems,
      dto.paymentMethod,
      dto.voucherAmount,
    );
    return this.pricingService.toPreviewResponse(pricedItems, amounts);
  }

  /** 建单：幂等 + 事务内库存预留 + 创建 ScanOrders（走扫码订单状态机，出餐时 bridge 落 SaleOrder）。 */
  async create(
    user: AuthenticatedUser,
    idempotencyKey: string | undefined,
    dto: CreateManualEntryOrderDto,
  ): Promise<ManualEntryOrderCreatedResponse> {
    if (!idempotencyKey || idempotencyKey.trim().length < 8) {
      throw new ConflictException('请提供有效的 Idempotency-Key 以录入订单');
    }
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: {
        scope_actorId_idempotencyKey: {
          scope: IDEMPOTENCY_SCOPE,
          actorId: user.id,
          idempotencyKey,
        },
      },
    });
    if (existing) return this.resolveExistingResponse(existing.resourceId);

    const storeId = await this.resolveStoreId(user);
    this.validateFormRules(dto);
    await this.validateDiningTable(storeId, dto);

    // 服务端权威定价：不信任前端任何金额
    const pricedItems = await this.pricingService.priceItems(
      storeId,
      dto.items,
    );
    const amounts = this.pricingService.calculateAmounts(
      pricedItems,
      dto.paymentMethod,
      dto.voucherAmount,
    );

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        await tx.idempotencyRecord.create({
          data: {
            scope: IDEMPOTENCY_SCOPE,
            actorId: user.id,
            idempotencyKey,
            requestHash: hashManualEntryRequest(dto),
            status: 'processing',
            expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
          },
        });
        await this.stockService.reserveStock(tx, storeId, pricedItems);
        return this.createScanOrderWithinTransaction(
          tx,
          storeId,
          user,
          dto,
          idempotencyKey,
          { pricedItems, amounts },
        );
      });

      this.logger.log(
        `录入订单已落库（ScanOrders）：orderId=${result.id}, orderNo=${result.orderNo}, storeId=${storeId}`,
      );
      // 推送实时事件：商家端订单页自动刷新（订单接收区 + dashboard + 桌台）
      this.realtimeService.publishOrderCreated({
        storeId,
        orderId: result.id,
        sessionId: null,
        status: 'pending_acceptance',
        paymentStatus: 'paid',
        fulfillmentStatus: 'preparing',
        pickupNumber: result.pickupNumber,
        pickupNumberLabel: result.pickupNumberLabel,
      });
      return {
        orderId: result.id,
        orderNo: result.orderNo,
        payableAmount: Money.fromDbCents(result.payableAmount).toOutputYuan(),
        createdAt: result.createdAt.getTime(),
      };
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      // 并发双击撞幂等唯一键：读取既有记录返回
      const raced = await this.prisma.idempotencyRecord.findUnique({
        where: {
          scope_actorId_idempotencyKey: {
            scope: IDEMPOTENCY_SCOPE,
            actorId: user.id,
            idempotencyKey,
          },
        },
      });
      if (raced) return this.resolveExistingResponse(raced.resourceId);
      throw error;
    }
  }

  /** 表单联动规则校验（与前端交互契约一致，后端兜底）。 */
  private validateFormRules(dto: CreateManualEntryOrderDto): void {
    if (dto.diningMode === 'dineIn' && dto.tableId === undefined) {
      throw new BadRequestException('堂食/团购到店必须选择桌台');
    }
    // 第三方外卖：支付方式强制平台结算（前端隐藏支付选择）
    if (dto.diningMode === 'platform' && dto.paymentMethod !== 'platform') {
      throw new BadRequestException('第三方外卖必须使用平台结算');
    }
    // 第三方外卖与平台结算场景必须选择来源渠道
    const requiresSourceChannel =
      dto.diningMode === 'platform' || dto.paymentMethod === 'platform';
    if (requiresSourceChannel && dto.sourceChannel === undefined) {
      throw new BadRequestException('平台结算订单必须选择来源渠道');
    }
    // 券面金额仅平台结算时有效，其余支付方式忽略（防御性校验）
    if (dto.paymentMethod !== 'platform' && dto.voucherAmount !== undefined) {
      throw new BadRequestException('券面金额仅平台结算时可以填写');
    }
  }

  /** 堂食桌台校验：存在、未删除、未停用且属于当前门店。 */
  private async validateDiningTable(
    storeId: number,
    dto: CreateManualEntryOrderDto,
  ): Promise<void> {
    if (dto.tableId === undefined) return;
    const table = await this.prisma.scanOrderingTable.findFirst({
      where: { id: dto.tableId, storeId, deletedAt: null },
      select: { id: true, name: true, status: true },
    });
    if (!table) {
      throw new NotFoundException('桌台不存在，请刷新桌台列表');
    }
    if (table.status === 'disabled') {
      throw new ConflictException(`桌台【${table.name}】已停用`);
    }
  }

  /**
   * 事务内创建 ScanOrders（手工补录单，号段 #M-YYYYMMDD-NNN）：
   * - 订单状态：pending_acceptance（与扫码单「已支付待接单」同态）
   * - 支付状态：paid（线下已收款）
   * - 库存：预留模式（reservedQuantity increment），接单时转扣减
   * - 不创建 SaleOrder（出餐时由 bridge 落库）
   * - 幂等记录关联 scan_order
   */
  private async createScanOrderWithinTransaction(
    tx: Prisma.TransactionClient,
    storeId: number,
    user: AuthenticatedUser,
    dto: CreateManualEntryOrderDto,
    idempotencyKey: string,
    priced: {
      pricedItems: ManualEntryPricedItem[];
      amounts: ManualEntryAmounts;
    },
  ): Promise<{
    id: number;
    orderNo: string;
    payableAmount: number;
    createdAt: Date;
    pickupNumber: number | null;
    pickupNumberLabel: string | null;
  }> {
    const now = new Date();
    const orderNo = await this.generateManualEntryScanOrderNo(tx, storeId, now);
    const specSignature = ''; // 手工单无购物车加购链路，规格签名无需参与唯一约束

    // 构建 manualEntryMetadata 快照
    const manualEntryMetadata: Record<string, unknown> = {
      diningMode:
        dto.diningMode === 'platform' && dto.isSelfPickup
          ? 'takeaway'
          : dto.diningMode,
      paymentMethod: dto.paymentMethod,
    };
    if (dto.sourceChannel)
      manualEntryMetadata.sourceChannel = dto.sourceChannel;
    if (dto.externalOrderNo)
      manualEntryMetadata.externalOrderNo = dto.externalOrderNo.trim();
    if (dto.grouponCode)
      manualEntryMetadata.grouponCode = dto.grouponCode.trim();
    if (dto.guestCount !== undefined)
      manualEntryMetadata.guestCount = dto.guestCount;
    if (dto.customerPhone)
      manualEntryMetadata.customerPhone = dto.customerPhone.trim();
    if (dto.voucherAmount !== undefined)
      manualEntryMetadata.voucherAmount = dto.voucherAmount;

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
        itemOriginalAmount: priced.amounts.itemsTotalCents,
        specificationExtraAmount: 0,
        productDiscountAmount: 0,
        orderDiscountAmount: priced.amounts.discountCents,
        serviceFeeAmount: 0,
        taxAmount: 0,
        payableAmount: priced.amounts.payableCents,
        paidAmount: priced.amounts.payableCents,
        status: ScanOrderStatus.pending_acceptance,
        paymentStatus: ScanOrderPaymentStatus.paid,
        fulfillmentStatus: ScanOrderFulfillmentStatus.preparing,
        paidAt: now,
        manualEntry: true,
        manualEntryMetadata: manualEntryMetadata as Prisma.InputJsonValue,
      },
      select: { id: true, orderNo: true, payableAmount: true, createdAt: true },
    });

    // 创建 ScanOrderItem + ScanOrderItemSpec 快照
    for (const item of priced.pricedItems) {
      const orderItem = await tx.scanOrderItem.create({
        data: {
          orderId: scanOrder.id,
          storeId,
          menuProductId: item.menuProductId,
          productNameSnapshot: item.productName,
          productImageUrlSnapshot: null,
          categoryNameSnapshot: item.categoryName,
          specSignature,
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

      void orderItem;
    }

    // 记录状态历史
    await tx.scanOrderStatusHistory.create({
      data: {
        orderId: scanOrder.id,
        storeId,
        fromStatus: ScanOrderStatus.pending_acceptance,
        toStatus: ScanOrderStatus.pending_acceptance,
        operatorType: 'merchant',
        operatorId: user.id,
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
    await tx.idempotencyRecord.updateMany({
      where: {
        scope: IDEMPOTENCY_SCOPE,
        actorId: user.id,
        idempotencyKey,
        status: 'processing',
      },
      data: {
        status: 'succeeded',
        resourceType: 'scan_order',
        resourceId: scanOrder.id,
        responseSnapshot: {
          orderId: scanOrder.id,
          orderNo: scanOrder.orderNo,
          payableAmount: Money.fromDbCents(
            scanOrder.payableAmount,
          ).toOutputYuan(),
          createdAt: scanOrder.createdAt.getTime(),
        },
      },
    });

    return {
      id: scanOrder.id,
      orderNo: scanOrder.orderNo,
      payableAmount: scanOrder.payableAmount,
      createdAt: scanOrder.createdAt,
      pickupNumber: pickup?.pickupNumber ?? null,
      pickupNumberLabel: pickup?.pickupNumberLabel ?? null,
    };
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

  /** 幂等命中后从 scan_orders 还原响应。 */
  private async resolveExistingResponse(
    scanOrderId: number | null,
  ): Promise<ManualEntryOrderCreatedResponse> {
    if (scanOrderId === null) {
      throw new ConflictException('订单正在处理中，请稍后刷新查看结果');
    }
    const order = await this.prisma.scanOrders.findUnique({
      where: { id: scanOrderId },
      select: { id: true, orderNo: true, payableAmount: true, createdAt: true },
    });
    if (!order) {
      throw new NotFoundException('录入订单不存在，请刷新后重试');
    }
    return {
      orderId: order.id,
      orderNo: order.orderNo,
      payableAmount: Money.fromDbCents(order.payableAmount).toOutputYuan(),
      createdAt: order.createdAt.getTime(),
    };
  }

  /** 统一解析当前商家门店并校验录入订单操作权限。 */
  private resolveStoreId(user: AuthenticatedUser): Promise<number> {
    return this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'scan-ordering:order-process',
      '无权操作录入订单',
    );
  }
}
