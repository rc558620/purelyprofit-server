// 团购券订单支付服务：创建订单草稿（JSAPI 下单 / 余额直接结算）→ 支付成功确认（生成券码 + 扣库存 + 起算有效期）
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Money } from '../../shared/money.utils';
import { PrismaService, TX_TIMEOUT_MEDIUM } from '../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../redis/invalidator';
import { ClubWechatJsapiService } from '../payments/club-wechat-jsapi.service';
import { ClubOrderPreviewBreakdownService } from '../orders/club-order-preview-breakdown.service';
import { deductPointsForSettlement } from '../orders/club-order-settlement-points.utils';
import { ScanOrderingRealtimeService } from '../scan-ordering/scan-ordering-realtime.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { settleVoucherBalancePayment } from './club-voucher-order-balance-settlement.helper';
import { ClubVoucherOrderContextService } from './club-voucher-order-context.service';
import { buildVoucherOrderNo } from './club-voucher-order-code.utils';
import {
  buildVoucherOrderBreakdownItems,
  buildVoucherOrderCreateInput,
  generateUniqueVoucherCode,
  toVoucherOrderDraftView,
} from './club-voucher-order-payment.helper';
import type {
  ClubVoucherOrderDraftView,
  PaidVoucherOrderSnapshot,
} from './club-voucher-order-payment.types';
import {
  CLUB_VOUCHER_ORDER_NOT_FOUND_MESSAGE,
  CLUB_VOUCHER_STOCK_NOT_ENOUGH_MESSAGE,
} from './club-voucher-orders.constants';
import { CLUB_VOUCHER_DEFAULT_VALID_DAYS } from './club-voucher-orders.types';
import type {
  ClubVoucherOrderResponseDto,
  CreateClubVoucherOrderDto,
} from './dto/club-voucher-order.dto';

@Injectable()
export class ClubVoucherOrderPaymentService {
  private readonly logger = new Logger(ClubVoucherOrderPaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clubVoucherOrderContextService: ClubVoucherOrderContextService,
    private readonly clubWechatJsapiService: ClubWechatJsapiService,
    private readonly breakdownService: ClubOrderPreviewBreakdownService,
    private readonly realtimeService: ScanOrderingRealtimeService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
  ) {}

  /** 创建团购券订单草稿：校验商品/算价 → JSAPI 下单 → 落库 unpaid */
  async createVoucherOrder(
    currentContext: ClubCurrentContext,
    dto: CreateClubVoucherOrderDto,
  ): Promise<ClubVoucherOrderResponseDto> {
    const context = await this.clubVoucherOrderContextService.resolveContext(
      currentContext,
      dto,
    );
    const quantity = dto.quantity ?? 1;
    const personCount = dto.personCount ?? context.product.personCount ?? 1;
    const pricing = await this.clubVoucherOrderContextService.resolvePricing(
      context,
      quantity,
      dto.usePoints === true,
    );

    if (context.product.stock < quantity) {
      throw new BadRequestException(CLUB_VOUCHER_STOCK_NOT_ENOUGH_MESSAGE);
    }

    const orderNo = buildVoucherOrderNo(Date.now());
    const breakdownItems = buildVoucherOrderBreakdownItems(
      this.breakdownService,
      pricing,
    );
    const paymentMethod = dto.paymentMethod ?? 'wechat';

    // 余额支付：下单即扣款，余额不足直接拒绝（避免落库 unpaid 脏单）
    if (
      paymentMethod === 'balance' &&
      context.customer.balance < pricing.paidAmountFen
    ) {
      throw new BadRequestException(
        `余额不足，当前余额 ¥${Money.fromDbCents(context.customer.balance).toFixedOutputYuan()}，需支付 ¥${Money.fromDbCents(pricing.paidAmountFen).toFixedOutputYuan()}`,
      );
    }

    // 微信 JSAPI 真实下单；openid 未传时开发态直接返回草稿（前端可走 confirmPaid 兜底）
    // 余额支付无需微信下单参数，直接落 unpaid 后在同一请求内完成结算
    const paymentParams =
      paymentMethod === 'wechat' && dto.openid
        ? await this.clubWechatJsapiService.createJsapiPaymentParams({
            storeId: context.store.id,
            orderNo,
            description: `购买${context.product.name}`,
            amountFen: pricing.paidAmountFen,
            openid: dto.openid,
          })
        : undefined;

    const created = await this.prisma.clubVoucherOrder.create({
      data: buildVoucherOrderCreateInput({
        orderNo,
        storeId: context.store.id,
        userId: currentContext.user.id,
        customerId: context.customer.id,
        product: context.product,
        guestName: currentContext.user.name,
        guestPhone: currentContext.user.phone,
        quantity,
        personCount,
        remark: dto.remark,
        pricing,
        breakdownItems,
        paymentMethod,
      }),
      select: { id: true },
    });

    // 余额支付：同一请求内完成落账（扣余额 + 生成券码 + 扣库存 + 起算有效期）
    if (paymentMethod === 'balance') {
      const view = await this.completePayment(
        created.id,
        pricing.paidAmountFen,
        undefined,
      );
      return {
        id: view.id,
        orderNo: view.orderNo,
        voucherCode: view.voucherCode ?? undefined,
        status: view.status,
        amountFen: view.amountFen,
      };
    }

    return {
      id: orderNo,
      orderNo,
      status: 'unpaid',
      amountFen: pricing.paidAmountFen,
      paymentParams,
    };
  }

  /** 用户端确认支付成功（开发态兜底）：unpaid → pending + 生成券码 + 扣库存 */
  async confirmOrderPaid(
    currentContext: ClubCurrentContext,
    orderNo: string,
  ): Promise<ClubVoucherOrderDraftView> {
    const order = await this.prisma.clubVoucherOrder.findFirst({
      where: { orderNo, userId: currentContext.user.id },
    });
    if (!order) {
      throw new BadRequestException(CLUB_VOUCHER_ORDER_NOT_FOUND_MESSAGE);
    }
    return this.completePayment(order.id, order.paidAmountFen, undefined);
  }

  /** 微信回调确认支付成功：按订单号路由，校验金额后完成落账 */
  async confirmOrderPaidByCallback(
    orderNo: string,
    params: { amountFen: number; transactionId?: string; paidAtMs?: number },
  ): Promise<ClubVoucherOrderDraftView> {
    const order = await this.prisma.clubVoucherOrder.findUnique({
      where: { orderNo },
    });
    if (!order) {
      throw new BadRequestException(CLUB_VOUCHER_ORDER_NOT_FOUND_MESSAGE);
    }
    if (order.paidAmountFen !== params.amountFen) {
      throw new BadRequestException('回调金额与订单金额不一致');
    }
    return this.completePayment(order.id, order.paidAmountFen, params);
  }

  /**
   * 支付完成事务：unpaid → pending，生成唯一券码，扣减库存，起算有效期
   * 幂等：已 pending/used 的订单重复确认直接返回，不重复扣库存
   */
  private async completePayment(
    orderId: number,
    expectedAmountFen: number,
    params?: { transactionId?: string; paidAtMs?: number },
  ): Promise<ClubVoucherOrderDraftView> {
    const { view, paidOrder } = await this.prisma.$transaction(
      async (
        tx,
      ): Promise<{
        view: ClubVoucherOrderDraftView;
        paidOrder: PaidVoucherOrderSnapshot | null;
      }> => {
        const order = await tx.clubVoucherOrder.findUnique({
          where: { id: orderId },
        });
        if (!order) {
          throw new BadRequestException(CLUB_VOUCHER_ORDER_NOT_FOUND_MESSAGE);
        }
        if (order.paidAmountFen !== expectedAmountFen) {
          throw new BadRequestException('订单金额不一致');
        }
        // 幂等：已确认支付（pending/used/refunded/expired）直接返回现状
        if (order.status !== 'unpaid') {
          return { view: toVoucherOrderDraftView(order), paidOrder: null };
        }

        const product = await tx.marketingProduct.findUnique({
          where: { id: order.productId },
          select: { stock: true, validDays: true },
        });
        if (!product || product.stock < order.quantity) {
          throw new BadRequestException(CLUB_VOUCHER_STOCK_NOT_ENOUGH_MESSAGE);
        }

        // 扣库存（行级条件更新，防止超卖）
        const decremented = await tx.marketingProduct.updateMany({
          where: { id: order.productId, stock: { gte: order.quantity } },
          data: { stock: { decrement: order.quantity } },
        });
        if (decremented.count !== 1) {
          throw new BadRequestException(CLUB_VOUCHER_STOCK_NOT_ENOUGH_MESSAGE);
        }

        // 余额支付：扣减储值余额 + 记消费流水 + 更新顾客指标 + 赠送消费积分
        if (order.paymentChannel === 'balance' && order.customerId !== null) {
          await settleVoucherBalancePayment(tx, order, order.customerId);
        }

        // BUG 修复：积分抵扣扣减在支付确认时执行（此前只在退款时返还、购买从未扣减，导致越退积分越多）
        if (order.pointsUsed > 0 && order.customerId !== null) {
          await deductPointsForSettlement(
            tx,
            {
              storeId: order.storeId,
              description: order.productName,
              paidAmountFen: order.paidAmountFen,
            },
            order.customerId,
            order.pointsUsed,
          );
        }

        // 生成唯一券码（碰撞重试）
        const voucherCode = await generateUniqueVoucherCode(tx);

        const validDays = product.validDays ?? CLUB_VOUCHER_DEFAULT_VALID_DAYS;
        const paidAt = params?.paidAtMs
          ? new Date(params.paidAtMs)
          : new Date();

        const updated = await tx.clubVoucherOrder.update({
          where: { id: orderId },
          data: {
            voucherCode,
            status: 'pending',
            transactionId: params?.transactionId ?? null,
            expiresAt: new Date(
              paidAt.getTime() + validDays * 24 * 60 * 60 * 1000,
            ),
          },
        });

        this.logger.log(
          `团购券订单支付成功: orderNo=${order.orderNo}, voucherCode=${voucherCode}, 有效期${validDays}天`,
        );
        return {
          view: toVoucherOrderDraftView(updated),
          paidOrder: {
            storeId: order.storeId,
            orderNo: order.orderNo,
            voucherCode,
            guestName: order.guestName,
            guestPhone: order.guestPhone,
            productName: order.productName,
            categoryName: order.categoryName,
            quantity: order.quantity,
            paidAmountFen: order.paidAmountFen,
            remark: order.remark,
            createdAt: order.createdAt,
          },
        };
      },
      { timeout: TX_TIMEOUT_MEDIUM },
    );

    if (paidOrder) {
      // 余额/积分已落账：失效营销衍生缓存（概览 / 顾客列表 / 顾客详情），
      // 否则商家端要等 TTL 才看得到变化
      await this.cacheInvalidatorService.invalidateMarketingCustomerDerived(
        paidOrder.storeId,
      );
      // 事务提交成功后才广播新订单事件，避免事务回滚导致商家端收到假通知
      this.realtimeService.publishVoucherOrderCreated({
        storeId: paidOrder.storeId,
        orderNo: paidOrder.orderNo,
        voucherCode: paidOrder.voucherCode,
        guestName: paidOrder.guestName,
        guestPhone: paidOrder.guestPhone,
        productName: paidOrder.productName,
        categoryName: paidOrder.categoryName,
        quantity: paidOrder.quantity,
        paidAmountFen: paidOrder.paidAmountFen,
        remark: paidOrder.remark,
        createdAt: paidOrder.createdAt.toISOString(),
      });
    }

    return view;
  }
}
