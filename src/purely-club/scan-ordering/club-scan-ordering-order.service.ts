import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { ClubNewCustomerQuotaService } from '../shared/club-new-customer-quota.service';
import { ClubCurrentStoreContextService } from '../stores/club-current-store-context.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ScanOrderingUnpaidOrderClosureService } from './scan-ordering-unpaid-order-closure.service';
import { ScanOrderingRealtimeService } from './scan-ordering-realtime.service';
import { ClubScanOrderingCartPricingService } from './club-scan-ordering-cart-pricing.service';
import { ClubScanOrderingCheckoutService } from './club-scan-ordering-checkout.service';
import { ClubScanOrderingOrderHistoryService } from './club-scan-ordering-order-history.service';
import { ClubScanOrderingOrderQueryService } from './club-scan-ordering-order-query.service';
import { ScanOrderingPickupNumberService } from './scan-ordering-pickup-number.service';
import { ClubScanOrderingInventoryReservationService } from './club-scan-ordering-inventory-reservation.service';
import { ClubScanOrderingMenuQueryService } from './club-scan-ordering-menu-query.service';
import type {
  ClubScanOrderStatusQueryDto,
  CreateClubScanOrderDto,
  ListClubScanOrdersQueryDto,
  PreviewClubScanOrderDto,
} from './dto/club-scan-ordering.dto';
import { ClubScanOrderingWechatVerifyService } from './club-scan-ordering-wechat-verify.service';
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
    private readonly quotaService: ClubNewCustomerQuotaService,
    private readonly unpaidOrderClosureService: ScanOrderingUnpaidOrderClosureService,
    private readonly realtimeService: ScanOrderingRealtimeService,
    private readonly cartPricingService: ClubScanOrderingCartPricingService,
    private readonly checkoutService: ClubScanOrderingCheckoutService,
    private readonly inventoryReservationService: ClubScanOrderingInventoryReservationService,
    private readonly previewService: ClubScanOrderingOrderPreviewService,
    private readonly orderQueryService: ClubScanOrderingOrderQueryService,
    private readonly orderHistoryService: ClubScanOrderingOrderHistoryService,
    private readonly pickupNumberService: ScanOrderingPickupNumberService,
    private readonly currentStoreContextService: ClubCurrentStoreContextService,
    private readonly menuQueryService: ClubScanOrderingMenuQueryService,
    private readonly wechatVerifyService: ClubScanOrderingWechatVerifyService,
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

    // 门店一致性：桌台会话所属门店必须等于当前门店。
    //
    // 扫桌码进店时后端已把当前门店切到桌台所属门店（见 ClubScanOrderingService
    // .createOrRestoreSession），所以正常情况下两者恒等；不等只可能是用户在别处
    // （另一台设备、或门店选择页）切了店，而本机还握着上一家店的会话——
    // 此时必须拦住，否则订单与新客额度都会记到用户已经离开的那家店头上。
    // 这道校验与其它下单链路同口径：自助下单按会话 storeId 过滤、团购券与
    // 服务商品比对 dto.storeId。
    const currentContext =
      await this.currentStoreContextService.requireCurrentContext(user);
    if (session.storeId !== currentContext.store.id) {
      throw new BadRequestException('当前门店已切换，请刷新页面后重试');
    }

    // 新客额度闸门：新客在额度耗尽时禁止下单，商家充值后才能继续。
    // 刻意放在定价之前——被拦时不必白算一轮价格与促销。
    // 老客（**本店**已消耗过额度）不受限制，见 ensureAvailableForNewCustomer。
    // 额度按门店独立计算：在别家店扣过不影响本店判定，本店扣过才算老客。
    await this.quotaService.assertAvailableForOrder(session.storeId, user.id);

    // 定价与定价版本共用一次取数（省掉版本计算的重复查询）
    const { items: pricedItems, pricingVersion } =
      await this.cartPricingService.priceCartWithPricingVersion(
        session.id,
        session.storeId,
      );
    const cartVersion = this.cartPricingService.cartVersion(pricedItems);
    if (cartVersion !== dto.cartVersion) {
      throw new ConflictException('购物车已更新，请刷新后重新确认订单');
    }
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
        await this.inventoryReservationService.reserveMenuProductStock(
          tx,
          pricedItems,
          session.storeId,
        );
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
              breakdownItems: promotionResult.breakdownItems,
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
        // 新客额度扣减：与订单落库在同一个事务里提交。
        // 扣不到额度（并发下被别人抢走最后一个）就抛错让整笔建单回滚，
        // 保证「服务的新客数」严格等于「扣掉的额度」。老客在此直接放行。
        await this.quotaService.consumeWithinOrderTransaction(
          tx,
          session.storeId,
          user.id,
          user.phone || null,
        );
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
      // 下单已预留库存并 bump 商品 version → menuVersion 变化。版本有短 TTL 缓存，
      // 不主动失效会让同桌/同店其他顾客最长延后一个 TTL 才看到可用库存下降。
      // 非关键路径：fire-and-forget，失败只等 TTL 兜底。
      void this.invalidateMenuVersionQuietly(session.storeId);
      // 商家端新订单通知需要展示「位置 · 商品摘要 · 金额」：位置已由 requireSession
      // 一并查出，桌台缺失时静默降级（仅展示商品摘要与金额）
      const table = session.table;
      const tableName = table?.name ?? null;
      // 位置口径与服务呼叫通知一致：区域 · 类型 · 桌位（如「1楼 · 大厅 · A01」）
      const locationLabel = table
        ? [table.area?.name, table.type?.name, table.name]
            .filter((value): value is string => Boolean(value?.trim()))
            .join(' · ') || null
        : null;
      this.realtimeService.publishOrderCreated({
        storeId: session.storeId,
        orderId: result.id,
        sessionId: session.id,
        // 带上创建时的乐观锁版本：商家端可据此直接接单（缺失时首次接单必然 409）
        version: result.version,
        status: 'pending_payment',
        paymentStatus: 'unpaid',
        fulfillmentStatus: 'preparing',
        orderNo: result.orderNo,
        tableName,
        locationLabel,
        items: pricedItems.map((item) => ({
          productName: item.productName,
          quantity: item.quantity,
        })),
        amountFen: promotionResult.afterPointsPayableAmount,
        remark: dto.remark?.trim() || null,
        createdAt: now.toISOString(),
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

  /**
   * 查询订单详情。
   *
   * verify=true 时先回微信侧核对并补落账，再读本地状态：
   * 前端在拉起支付后结果未知（unknown）时用这个入口确认用户是否已扣款。
   */
  async getOrder(
    user: AuthenticatedUser,
    orderId: number,
    query?: ClubScanOrderStatusQueryDto,
  ): Promise<unknown> {
    if (query?.verify === true) {
      await this.wechatVerifyService.verifyAndSettle(user.id, orderId);
    }

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
    return {
      ...order,
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
    openid?: string,
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
      // 带上桌台及其区域/类型：下单成功后的实时通知要拼「区域 · 类型 · 桌位」，
      // 随会话一次查出，省掉提交后再补查 scanOrderingTable 的那一次往返
      // （通知是 fire-and-forget，查询本不该卡在关键路径上）。
      include: {
        table: {
          select: {
            name: true,
            area: { select: { name: true } },
            type: { select: { name: true } },
          },
        },
      },
    });
    if (!session?.tableId)
      throw new ForbiddenException('当前桌台会话不可用，请重新扫码');
    return session;
  }

  /** 失效菜单版本缓存（fire-and-forget，失败仅记录日志）。 */
  private async invalidateMenuVersionQuietly(storeId: number): Promise<void> {
    try {
      await this.menuQueryService.invalidateMenuVersion(storeId);
    } catch (error) {
      this.logger.warn(
        `失效菜单版本缓存失败 storeId=${storeId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
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
