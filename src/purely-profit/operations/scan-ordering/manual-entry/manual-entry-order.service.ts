// 录入订单建单服务：编排幂等控制、表单校验、服务端定价、库存预留与 ScanOrders 落库，
// 后置处理含配额累加与实时事件推送（金额全部服务端权威计算，出餐时才由 bridge 落 SaleOrder）

import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { Money } from '../../../../shared/money.utils';
import { CommerceAccessService } from '../../../commerce/commerce-access.service';
import type { AuthenticatedUser } from '../../../auth/strategies/jwt.strategy';
import { ScanOrderingRealtimeService } from '../../../../purely-club/scan-ordering/scan-ordering-realtime.service';
import { MembershipDowngradeService } from '../../../member/platform-membership/membership-downgrade.service';
import {
  ManualEntryPricingService,
  type ManualEntryAmounts,
} from './manual-entry-pricing.service';
import type { ManualEntryPricedItem } from './manual-entry-pricing.service';
import { ManualEntryStockService } from './manual-entry-stock.service';
import { ManualEntryIdempotencyService } from './manual-entry-idempotency.service';
import { ManualEntryOrderValidator } from './manual-entry-order-validator.service';
import {
  ManualEntryScanOrderWriter,
  type ManualEntryWrittenScanOrder,
} from './manual-entry-scan-order-writer.service';
import type {
  CreateManualEntryOrderDto,
  ManualEntryPreviewDto,
} from './dto/manual-entry.dto';
import type {
  ManualEntryOrderCreatedResponse,
  ManualEntryPreviewResponse,
} from './manual-entry.types';

/**
 * 录入订单建单与预览编排服务。
 *
 * 编排顺序（与 reviewers 约定一致）：幂等 → 门店/权限 → 额度原子预占 → 表单校验
 * → 服务端权威定价 → 事务（幂等占位 + 库存预留 + 落 ScanOrders）
 * → 实时推送。建单失败时归还预占额度，成功后额度即被这一单占用。
 */
@Injectable()
export class ManualEntryOrderService {
  private readonly logger = new Logger(ManualEntryOrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly pricingService: ManualEntryPricingService,
    private readonly stockService: ManualEntryStockService,
    private readonly realtimeService: ScanOrderingRealtimeService,
    private readonly downgradeService: MembershipDowngradeService,
    private readonly idempotencyService: ManualEntryIdempotencyService,
    private readonly validator: ManualEntryOrderValidator,
    private readonly writer: ManualEntryScanOrderWriter,
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

  /**
   * 建单：幂等 + 额度原子预占 + 事务内库存预留 + 创建 ScanOrders
   *（走扫码订单状态机，出餐时 bridge 落 SaleOrder）。
   */
  async create(
    user: AuthenticatedUser,
    idempotencyKey: string | undefined,
    dto: CreateManualEntryOrderDto,
  ): Promise<ManualEntryOrderCreatedResponse> {
    const key = this.idempotencyService.ensureValidKey(idempotencyKey);
    const requestHash = this.idempotencyService.hashRequest(dto);

    const existing = await this.idempotencyService.find(user.id, key);
    if (existing) {
      this.idempotencyService.ensureSameRequest(existing, requestHash);
      return this.idempotencyService.resolveExistingResponse(
        existing.resourceId,
      );
    }

    const storeId = await this.resolveStoreId(user);

    /*
     * 会员过期账号的营业兜底通道：先原子预占一次额度，再进入校验 / 定价 / 建单。
     *
     * 「先占后建」而不是「先查后建再累加」：
     * - 旧实现的校验与递增是两次独立往返，并发请求会读到同一份计数而全部放行；
     * - 且递增发生在建单成功之后，一旦递增失败，订单已提交但接口报错。
     * 预占成功后的任何失败都必须在 catch 里归还，否则额度会被白吃。
     */
    const quotaReserved =
      await this.downgradeService.consumeManualEntryQuota(storeId);

    let created: ManualEntryWrittenScanOrder;
    let pricedItems: ManualEntryPricedItem[];

    try {
      await this.validator.validate(storeId, dto);

      // 服务端权威定价：不信任前端任何金额
      pricedItems = await this.pricingService.priceItems(storeId, dto.items);
      const amounts = this.pricingService.calculateAmounts(
        pricedItems,
        dto.paymentMethod,
        dto.voucherAmount,
      );

      created = await this.createWithinTransaction(
        storeId,
        user,
        dto,
        key,
        requestHash,
        { pricedItems, amounts },
      );
    } catch (error) {
      // 本次预占没有换来新订单（校验失败 / 事务回滚 / 并发双击回放），额度必须归还
      if (quotaReserved) {
        await this.downgradeService.releaseManualEntryQuota(storeId);
      }
      return this.replayRacedOrThrow(user.id, key, requestHash, error);
    }

    /*
     * 订单已提交：后面的日志 / 位置查询 / 实时推送都是「尽力而为」的附带动作。
     * 它们失败不能让接口报错（客户端重试会命中幂等回放），也**不能再归还额度**
     * ——额度已经被这一单真实占用。
     */
    this.logger.log(
      `录入订单已落库（ScanOrders）：orderId=${created.id}, orderNo=${created.orderNo}, storeId=${storeId}`,
    );
    // 商家端新订单通知需要展示「位置 · 商品摘要 · 金额」：位置单独查一次并静默降级
    let tableName: string | null = null;
    let locationLabel: string | null = null;
    if (dto.tableId) {
      try {
        const table = await this.prisma.scanOrderingTable.findUnique({
          where: { id: dto.tableId },
          select: {
            name: true,
            area: { select: { name: true } },
            type: { select: { name: true } },
          },
        });
        tableName = table?.name ?? null;
        // 位置口径与服务呼叫通知一致：区域 · 类型 · 桌位（如「1楼 · 大厅 · A01」）
        locationLabel =
          [table?.area?.name, table?.type?.name, table?.name]
            .filter((value): value is string => Boolean(value?.trim()))
            .join(' · ') || null;
      } catch {
        tableName = null;
        locationLabel = null;
      }
    }
    // 推送实时事件：商家端订单页自动刷新（订单接收区 + dashboard + 桌台）+ 新订单通知
    this.realtimeService.publishOrderCreated({
      storeId,
      orderId: created.id,
      sessionId: null,
      version: created.version,
      status: 'pending_acceptance',
      paymentStatus: 'paid',
      fulfillmentStatus: 'preparing',
      pickupNumber: created.pickupNumber,
      pickupNumberLabel: created.pickupNumberLabel,
      orderNo: created.orderNo,
      tableName,
      locationLabel,
      items: pricedItems.map((item) => ({
        productName: item.displayName,
        quantity: item.quantity,
      })),
      amountFen: created.payableAmount,
      remark: dto.remark?.trim() || null,
      createdAt: created.createdAt.toISOString(),
    });

    return {
      orderId: created.id,
      orderNo: created.orderNo,
      payableAmount: Money.fromDbCents(created.payableAmount).toOutputYuan(),
      createdAt: created.createdAt.getTime(),
    };
  }

  /** 事务编排：幂等占位 → 库存预留 → 落 ScanOrders，任一失败整体回滚。 */
  private createWithinTransaction(
    storeId: number,
    user: AuthenticatedUser,
    dto: CreateManualEntryOrderDto,
    idempotencyKey: string,
    requestHash: string,
    priced: {
      pricedItems: ManualEntryPricedItem[];
      amounts: ManualEntryAmounts;
    },
  ): Promise<ManualEntryWrittenScanOrder> {
    return this.prisma.$transaction(async (tx) => {
      await this.idempotencyService.claim(
        tx,
        user.id,
        idempotencyKey,
        requestHash,
      );
      await this.stockService.reserveStock(tx, storeId, priced.pricedItems);
      return this.writer.create(tx, {
        storeId,
        actorId: user.id,
        dto,
        idempotencyKey,
        pricedItems: priced.pricedItems,
        amounts: priced.amounts,
      });
    });
  }

  /**
   * 异常兜底：并发双击撞幂等唯一键时读取既有记录回放；其余异常原样抛出。
   */
  private async replayRacedOrThrow(
    actorId: number,
    idempotencyKey: string,
    requestHash: string,
    error: unknown,
  ): Promise<ManualEntryOrderCreatedResponse> {
    if (error instanceof ConflictException) throw error;
    // 并发双击撞幂等唯一键：读取既有记录返回
    const raced = await this.idempotencyService.find(actorId, idempotencyKey);
    if (raced) {
      this.idempotencyService.ensureSameRequest(raced, requestHash);
      return this.idempotencyService.resolveExistingResponse(raced.resourceId);
    }
    throw error;
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
