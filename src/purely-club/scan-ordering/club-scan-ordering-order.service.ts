import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CLUB_SCAN_ORDERING_ERROR_CODE,
  clubScanOrderingError,
} from './club-scan-ordering.errors';
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
import { ClubScanOrderingInventoryReservationService } from './club-scan-ordering-inventory-reservation.service';
import type {
  ClubScanOrderStatusQueryDto,
  CreateClubScanOrderDto,
  ListClubScanOrdersQueryDto,
  PreviewClubScanOrderDto,
} from './dto/club-scan-ordering.dto';
import { ClubScanOrderingWechatVerifyService } from './club-scan-ordering-wechat-verify.service';
import { ClubScanOrderingOrderPreviewService } from './club-scan-ordering-order-preview.service';
import { createClubScanOrder } from './club-scan-ordering-order-create.flow';
import type { CreateOrderFlowDeps } from './club-scan-ordering-order-create.flow';

/**
 * C 端扫码点餐订单门面。
 *
 * 本类只做三件事：路由到子服务（查询 / 历史 / 收银 / 预览）、维护跨子服务的
 * 事务边界（取消订单）、把建单流程的依赖透传给
 * {@link createClubScanOrder}。建单的幂等、门店一致性、新客额度与落库细节
 * 都在 create flow 里，避免这个入口再次膨胀成「什么都干」的大文件。
 */
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
    private readonly currentStoreContextService: ClubCurrentStoreContextService,
    private readonly wechatVerifyService: ClubScanOrderingWechatVerifyService,
  ) {}

  /** 建单流程依赖：与构造注入同源，避免流程内出现第二套服务定位逻辑 */
  private get createFlowDeps(): CreateOrderFlowDeps {
    return {
      prisma: this.prisma,
      quotaService: this.quotaService,
      currentStoreContextService: this.currentStoreContextService,
      cartPricingService: this.cartPricingService,
      inventoryReservationService: this.inventoryReservationService,
      realtimeService: this.realtimeService,
      logger: this.logger,
    };
  }

  preview(
    user: AuthenticatedUser,
    dto: PreviewClubScanOrderDto,
  ): Promise<unknown> {
    return this.previewService.preview(user, dto);
  }

  /** 幂等建单：流程见 {@link createClubScanOrder}。 */
  create(
    user: AuthenticatedUser,
    idempotencyKey: string | undefined,
    dto: CreateClubScanOrderDto,
  ): Promise<unknown> {
    return createClubScanOrder(this.createFlowDeps, {
      user,
      idempotencyKey,
      dto,
    });
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
    return this.orderQueryService.getOrder(user, orderId);
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

  /** 取消待支付订单：本人订单 + 待支付前置状态，再交给统一的关单逻辑。 */
  async cancelOrder(
    user: AuthenticatedUser,
    orderId: number,
    version: number,
  ): Promise<void> {
    const order = await this.prisma.scanOrders.findFirst({
      where: { id: orderId, clubUserId: user.id, deletedAt: null },
      select: { id: true, storeId: true, status: true, version: true },
    });
    if (!order)
      throw new NotFoundException(
        clubScanOrderingError(
          CLUB_SCAN_ORDERING_ERROR_CODE.RESOURCE_ORDER_NOT_FOUND,
          '订单不存在',
        ),
      );
    if (order.status !== 'pending_payment')
      throw new ConflictException(
        clubScanOrderingError(
          CLUB_SCAN_ORDERING_ERROR_CODE.STATUS_ORDER_NOT_CANCELLABLE,
          '当前订单不可取消',
        ),
      );
    const closed = await this.unpaidOrderClosureService.close({
      orderId: order.id,
      expectedVersion: version,
      operatorType: 'club_user',
      operatorId: user.id,
      reason: '用户取消',
    });
    if (!closed) {
      throw new ConflictException(
        clubScanOrderingError(
          CLUB_SCAN_ORDERING_ERROR_CODE.STATUS_ORDER_STATE_CHANGED,
          '订单状态已变化，请刷新后重试',
        ),
      );
    }
  }
}
