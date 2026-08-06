import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { ScanOrderingUnpaidOrderClosureService } from './scan-ordering-unpaid-order-closure.service';
import { ScanOrderingPricingVersionService } from './scan-ordering-pricing-version.service';
import { ScanOrderingRealtimeService } from './scan-ordering-realtime.service';
import { ClubScanOrderingCartPricingService } from './club-scan-ordering-cart-pricing.service';
import { ClubScanOrderingCheckoutService } from './club-scan-ordering-checkout.service';
import { ClubScanOrderingOrderHistoryService } from './club-scan-ordering-order-history.service';
import { ClubScanOrderingOrderQueryService } from './club-scan-ordering-order-query.service';
import { ScanOrderingPickupNumberService } from './scan-ordering-pickup-number.service';
import type {
  CreateClubScanOrderDto,
  ListClubScanOrdersQueryDto,
  PreviewClubScanOrderDto,
} from './dto/club-scan-ordering.dto';
import { ClubScanOrderingOrderPreviewService } from './club-scan-ordering-order-preview.service';
import {
  createScanOrderNo,
  hashScanOrderRequest,
} from './club-scan-ordering-order.utils';
import {
  fenToYuan,
  toOrderAmountSummary,
} from './club-scan-ordering-order.mapper';

const PAYMENT_TIMEOUT_MS = 15 * 60 * 1000;
const IDEMPOTENCY_SCOPE = 'club:scan-order:create';

@Injectable()
export class ClubScanOrderingOrderService {
  private readonly logger = new Logger(ClubScanOrderingOrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly unpaidOrderClosureService: ScanOrderingUnpaidOrderClosureService,
    private readonly pricingVersionService: ScanOrderingPricingVersionService,
    private readonly realtimeService: ScanOrderingRealtimeService,
    private readonly cartPricingService: ClubScanOrderingCartPricingService,
    private readonly checkoutService: ClubScanOrderingCheckoutService,
    private readonly previewService: ClubScanOrderingOrderPreviewService,
    private readonly orderQueryService: ClubScanOrderingOrderQueryService,
    private readonly orderHistoryService: ClubScanOrderingOrderHistoryService,
    private readonly pickupNumberService: ScanOrderingPickupNumberService,
  ) {}

  preview(
    user: AuthenticatedUser,
    dto: PreviewClubScanOrderDto,
  ): Promise<unknown> {
    return this.previewService.preview(user, dto);
  }

  async create(
    user: AuthenticatedUser,
    idempotencyKey: string | undefined,
    dto: CreateClubScanOrderDto,
  ): Promise<unknown> {
    if (!idempotencyKey || idempotencyKey.trim().length < 8) {
      throw new ConflictException('请提供有效的 Idempotency-Key 以创建订单');
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
    if (existing) return this.resolveExistingIdempotency(existing);

    const session = await this.requireSession(user, dto.sessionId);
    const pricedItems = await this.cartPricingService.priceCart(
      session.id,
      session.storeId,
    );
    const cartVersion = this.cartPricingService.cartVersion(pricedItems);
    if (cartVersion !== dto.cartVersion) {
      throw new ConflictException('购物车已更新，请刷新后重新确认订单');
    }
    const pricingVersion =
      await this.pricingVersionService.computePricingVersion(session.id);
    if (dto.pricingVersion !== pricingVersion) {
      throw new ConflictException('订单价格已变化，请重新确认订单');
    }
    const promotionResult = await this.cartPricingService.resolvePromotions(
      session.storeId,
      user.id,
      session.id,
      pricedItems,
      dto.usePoints === true,
    );
    const amounts = this.cartPricingService.calculateAmounts(
      pricedItems,
      promotionResult,
    );

    const now = new Date();
    const expiresAt = new Date(now.getTime() + PAYMENT_TIMEOUT_MS);
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        await tx.idempotencyRecord.create({
          data: {
            scope: IDEMPOTENCY_SCOPE,
            actorId: user.id,
            idempotencyKey,
            requestHash: hashScanOrderRequest(dto),
            status: 'processing',
            expiresAt,
          },
        });
        for (const item of pricedItems) {
          if (item.inventoryProductId) {
            const inventoryUpdated = await tx.product.updateMany({
              where: {
                id: item.inventoryProductId,
                storeId: session.storeId,
                isActive: true,
                deletedAt: null,
                stock: { gte: item.quantity },
              },
              data: { stock: { decrement: item.quantity } },
            });
            if (inventoryUpdated.count === 0)
              throw new ConflictException('商品库存不足');
            await tx.scanOrderingMenuProduct.update({
              where: { id: item.productId },
              data: {
                salesCount: { increment: item.quantity },
                version: { increment: 1 },
              },
            });
            continue;
          }
          const updated = await tx.scanOrderingMenuProduct.updateMany({
            where: {
              id: item.productId,
              storeId: session.storeId,
              isActive: true,
              deletedAt: null,
              OR: [
                { stockMode: 'unlimited' },
                { stockMode: 'finite', stockQuantity: { gte: item.quantity } },
              ],
            },
            data: {
              stockQuantity: { decrement: item.quantity },
              salesCount: { increment: item.quantity },
              version: { increment: 1 },
            },
          });
          if (updated.count === 0) throw new ConflictException('商品库存不足');
        }
        await this.cartPricingService.reserveFiniteSpecStock(tx, pricedItems);
        await tx.scanOrderingSession.update({
          where: { id: session.id },
          data: {
            guestCount: Math.max(session.guestCount, dto.guestCount),
            lastActiveAt: new Date(),
          },
        });
        const order = await tx.scanOrders.create({
          data: {
            storeId: session.storeId,
            tableId: session.tableId!,
            sessionId: session.id,
            clubUserId: user.id,
            diningRoundId: session.diningRoundId,
            orderNo: createScanOrderNo(),
            guestCount: dto.guestCount,
            remark: dto.remark,
            idempotencyKey,
            pricingVersion,
            marketingSnapshot: {
              memberBenefits: promotionResult.memberBenefits,
              appliedPromotions: promotionResult.appliedPromotions,
              availableCoupons: promotionResult.availableCoupons.filter(
                (coupon) => coupon.usable,
              ),
              productDiscountAmount: amounts.productDiscountAmount,
              orderDiscountAmount: amounts.orderDiscountAmount,
              usePoints: dto.usePoints === true,
              pointsDeductAmount: promotionResult.pointsDeductAmount,
              pointsUsed: promotionResult.pointsUsed,
              redeemRatioPoints: promotionResult.redeemRatioPoints,
              availablePoints: promotionResult.availablePoints,
              pointsSettlementStatus: 'pending',
            },
            itemOriginalAmount: amounts.itemOriginalAmount,
            specificationExtraAmount: amounts.specificationExtraAmount,
            productDiscountAmount: amounts.productDiscountAmount,
            orderDiscountAmount: amounts.orderDiscountAmount,
            serviceFeeAmount: amounts.serviceFeeAmount,
            taxAmount: amounts.taxAmount,
            payableAmount: promotionResult.afterPointsPayableAmount,
            paymentExpiresAt: expiresAt,
            items: {
              create: this.cartPricingService.buildOrderItemCreateData(
                pricedItems,
                amounts.productDiscountAmount,
                session.storeId,
              ),
            },
          },
          select: {
            id: true,
            orderNo: true,
            payableAmount: true,
            paymentExpiresAt: true,
            version: true,
          },
        });
        await tx.scanOrderStatusHistory.create({
          data: {
            orderId: order.id,
            storeId: session.storeId,
            fromStatus: 'pending_payment',
            toStatus: 'pending_payment',
            operatorType: 'club_user',
            operatorId: user.id,
            reason: '用户创建扫码点餐订单',
          },
        });
        await tx.scanOrderingCartItem.updateMany({
          where: { sessionId: session.id, status: 'active', deletedAt: null },
          data: { status: 'ordered', version: { increment: 1 } },
        });
        const response = {
          ...order,
          paymentExpiresAt: order.paymentExpiresAt?.toISOString() ?? null,
        };
        await tx.idempotencyRecord.update({
          where: {
            scope_actorId_idempotencyKey: {
              scope: IDEMPOTENCY_SCOPE,
              actorId: user.id,
              idempotencyKey,
            },
          },
          data: {
            status: 'succeeded',
            resourceType: 'scan_order',
            resourceId: order.id,
            responseSnapshot: response,
          },
        });
        return response;
      });
      this.logger.log(
        `订单已落库，准备发布 order.created: orderId=${result.id}, storeId=${session.storeId}, sessionId=${session.id}, pid=${process.pid}`,
      );
      this.realtimeService.publishOrderCreated({
        storeId: session.storeId,
        orderId: result.id,
        sessionId: session.id,
        status: 'pending_payment',
        paymentStatus: 'unpaid',
        fulfillmentStatus: 'preparing',
      });
      return result;
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      const raced = await this.prisma.idempotencyRecord.findUnique({
        where: {
          scope_actorId_idempotencyKey: {
            scope: IDEMPOTENCY_SCOPE,
            actorId: user.id,
            idempotencyKey,
          },
        },
      });
      if (raced) return this.resolveExistingIdempotency(raced);
      throw error;
    }
  }

  listOrders(
    user: AuthenticatedUser,
    query: ListClubScanOrdersQueryDto,
  ): Promise<unknown> {
    return this.orderQueryService.listOrders(user, query);
  }

  listOrderHistory(
    user: AuthenticatedUser,
    query: ListClubScanOrdersQueryDto,
  ): Promise<unknown> {
    return this.orderHistoryService.listOrderHistory(user, query);
  }

  async getOrder(user: AuthenticatedUser, orderId: number): Promise<unknown> {
    const order = await this.prisma.scanOrders.findFirst({
      where: { id: orderId, clubUserId: user.id, deletedAt: null },
      include: {
        items: { include: { specs: true }, orderBy: { sortOrder: 'asc' } },
        paymentAttempts: { orderBy: { createdAt: 'desc' }, take: 1 },
        refundTasks: { orderBy: { createdAt: 'desc' }, take: 1 },
        balanceTransactions: {
          where: { type: 'refund' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true },
        },
      },
    });
    if (!order) throw new NotFoundException('订单不存在');
    const { marketingSnapshot: _marketingSnapshot, ...orderFields } = order;
    return {
      ...orderFields,
      items: order.items.map((item) => ({
        ...item,
        unitPriceAmount: fenToYuan(item.unitPriceAmount),
        lineTotalAmount: fenToYuan(item.lineTotalAmount),
        payableLineAmount: fenToYuan(item.payableLineAmount),
      })),
      ...toOrderAmountSummary(order),
      pickupNumberLabel: this.pickupNumberService.formatPickupNumber(
        order.pickupNumber,
      ),
      pickupCalledAt: order.pickupCalledAt?.toISOString() ?? null,
      pickupCompletedAt: order.pickupCompletedAt?.toISOString() ?? null,
      refundTasks: order.refundTasks.map((task) => ({
        ...task,
        refundSucceededAt:
          task.refundSucceededAt ??
          task.processedAt ??
          task.triggeredAt ??
          order.balanceTransactions[0]?.createdAt ??
          null,
      })),
    };
  }

  createWechatPayment(
    user: AuthenticatedUser,
    orderId: number,
    openid: string,
  ): Promise<unknown> {
    return this.checkoutService.createWechatPayment(user, orderId, openid);
  }

  createBalancePayment(
    user: AuthenticatedUser,
    orderId: number,
    version: number,
  ): Promise<unknown> {
    return this.checkoutService.createBalancePayment(user, orderId, version);
  }

  confirmPaidForDevelopment(
    user: AuthenticatedUser,
    orderId: number,
  ): Promise<unknown> {
    return this.checkoutService.confirmPaidForDevelopment(user, orderId);
  }

  async cancelOrder(
    user: AuthenticatedUser,
    orderId: number,
    version: number,
  ): Promise<void> {
    const order = await this.prisma.scanOrders.findFirst({
      where: { id: orderId, clubUserId: user.id, deletedAt: null },
      select: { id: true, storeId: true, status: true, version: true },
    });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.status !== 'pending_payment')
      throw new ConflictException('当前订单不可取消');
    const closed = await this.unpaidOrderClosureService.close({
      orderId: order.id,
      expectedVersion: version,
      operatorType: 'club_user',
      operatorId: user.id,
      reason: '用户取消',
    });
    if (!closed) {
      throw new ConflictException('订单状态已变化，请刷新后重试');
    }
  }

  private async requireSession(user: AuthenticatedUser, sessionId: number) {
    const session = await this.prisma.scanOrderingSession.findFirst({
      where: {
        id: sessionId,
        clubUserId: user.id,
        status: 'active',
        expiresAt: { gt: new Date() },
        deletedAt: null,
      },
    });
    if (!session?.tableId)
      throw new ForbiddenException('当前桌台会话不可用，请重新扫码');
    return session;
  }

  private resolveExistingIdempotency(record: {
    status: string;
    responseSnapshot: unknown;
  }): unknown {
    if (record.status === 'succeeded' && record.responseSnapshot)
      return record.responseSnapshot;
    throw new ConflictException('订单正在创建中，请稍后重试');
  }
}
