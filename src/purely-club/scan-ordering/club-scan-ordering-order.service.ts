import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { ScanOrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ScanOrderingUnpaidOrderClosureService } from './scan-ordering-unpaid-order-closure.service';
import { ScanOrderingPricingVersionService } from './scan-ordering-pricing-version.service';
import { ScanOrderingRealtimeService } from './scan-ordering-realtime.service';
import { ClubScanOrderingCartPricingService } from './club-scan-ordering-cart-pricing.service';
import { ClubScanOrderingCheckoutService } from './club-scan-ordering-checkout.service';
import type {
  CreateClubScanOrderDto,
  ListClubScanOrdersQueryDto,
  PreviewClubScanOrderDto,
} from './dto/club-scan-ordering.dto';

const PAYMENT_TIMEOUT_MS = 15 * 60 * 1000;
const IDEMPOTENCY_SCOPE = 'club:scan-order:create';

@Injectable()
export class ClubScanOrderingOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly unpaidOrderClosureService: ScanOrderingUnpaidOrderClosureService,
    private readonly pricingVersionService: ScanOrderingPricingVersionService,
    private readonly realtimeService: ScanOrderingRealtimeService,
    private readonly cartPricingService: ClubScanOrderingCartPricingService,
    private readonly checkoutService: ClubScanOrderingCheckoutService,
  ) {}

  async preview(
    user: AuthenticatedUser,
    dto: PreviewClubScanOrderDto,
  ): Promise<unknown> {
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
    const promotionResult = await this.cartPricingService.resolvePromotions(
      session.storeId,
      user.id,
      session.id,
      pricedItems,
    );
    const amounts = this.cartPricingService.calculateAmounts(
      pricedItems,
      promotionResult,
    );
    return this.cartPricingService.toPreview(
      session.id,
      dto,
      pricedItems,
      cartVersion,
      pricingVersion,
      amounts,
      promotionResult,
    );
  }

  async create(
    user: AuthenticatedUser,
    idempotencyKey: string | undefined,
    dto: CreateClubScanOrderDto,
  ): Promise<unknown> {
    if (!idempotencyKey || idempotencyKey.trim().length < 8) {
      throw new ConflictException('请提供有效的 Idempotency-Key 以创建订单');
    }
    const requestHash = this.hashRequest(dto);
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: {
        scope_actorId_idempotencyKey: {
          scope: IDEMPOTENCY_SCOPE,
          actorId: user.id,
          idempotencyKey,
        },
      },
    });
    if (existing) return this.resolveExistingIdempotency(existing, requestHash);

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
            requestHash,
            status: 'processing',
            expiresAt,
          },
        });
        for (const item of pricedItems) {
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
        const order = await tx.scanOrders.create({
          data: {
            storeId: session.storeId,
            tableId: session.tableId!,
            sessionId: session.id,
            clubUserId: user.id,
            orderNo: this.orderNo(),
            guestCount: dto.guestCount,
            remark: dto.remark,
            idempotencyKey,
            pricingVersion,
            itemOriginalAmount: amounts.itemOriginalAmount,
            specificationExtraAmount: amounts.specificationExtraAmount,
            productDiscountAmount: amounts.productDiscountAmount,
            orderDiscountAmount: amounts.orderDiscountAmount,
            serviceFeeAmount: amounts.serviceFeeAmount,
            taxAmount: amounts.taxAmount,
            payableAmount: amounts.payableAmount,
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
      // 订单创建后通知 C 端订单房间和会话房间（不通知商家门店房间）
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
      if (raced) return this.resolveExistingIdempotency(raced, requestHash);
      throw error;
    }
  }

  async listOrders(
    user: AuthenticatedUser,
    query: ListClubScanOrdersQueryDto,
  ): Promise<unknown> {
    const take = (query.limit ?? 20) + 1;
    const orders = await this.prisma.scanOrders.findMany({
      where: {
        clubUserId: user.id,
        deletedAt: null,
        ...(query.status ? { status: query.status as ScanOrderStatus } : {}),
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take,
      select: {
        id: true,
        orderNo: true,
        status: true,
        paymentStatus: true,
        fulfillmentStatus: true,
        payableAmount: true,
        paidAmount: true,
        createdAt: true,
        paymentExpiresAt: true,
        table: { select: { name: true, tableCode: true } },
        items: {
          take: 3,
          orderBy: { sortOrder: 'asc' },
          select: { productNameSnapshot: true, quantity: true },
        },
      },
    });
    const hasMore = orders.length === take;
    const items = hasMore ? orders.slice(0, -1) : orders;
    return { items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
  }

  async getOrder(user: AuthenticatedUser, orderId: number): Promise<unknown> {
    const order = await this.prisma.scanOrders.findFirst({
      where: { id: orderId, clubUserId: user.id, deletedAt: null },
      include: {
        items: { include: { specs: true }, orderBy: { sortOrder: 'asc' } },
        paymentAttempts: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!order) throw new NotFoundException('订单不存在');
    return order;
  }

  createWechatPayment(
    user: AuthenticatedUser,
    orderId: number,
    openid: string,
  ): Promise<unknown> {
    return this.checkoutService.createWechatPayment(user, orderId, openid);
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

  private resolveExistingIdempotency(
    record: { requestHash: string; status: string; responseSnapshot: unknown },
    requestHash: string,
  ): unknown {
    if (record.requestHash !== requestHash)
      throw new ConflictException('Idempotency-Key 不能用于不同请求');
    if (record.status === 'succeeded' && record.responseSnapshot)
      return record.responseSnapshot;
    throw new ConflictException('订单正在创建中，请稍后重试');
  }

  private hashRequest(dto: unknown): string {
    const json = JSON.stringify(dto);
    let hash = 0;
    for (let i = 0; i < json.length; i++) {
      const char = json.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return hash.toString(16);
  }

  private orderNo(): string {
    return `SO${Date.now()}${randomBytes(3).toString('hex').toUpperCase()}`;
  }
}
