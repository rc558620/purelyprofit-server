// 团购券订单支付服务：创建订单草稿（JSAPI 下单 / 余额直接结算）→ 支付成功确认（生成券码 + 扣库存 + 起算有效期）
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { calcCustomerTier } from '../../purely-profit/marketing/marketing.utils';
import { Money } from '../../shared/money.utils';
import { PrismaService, TX_TIMEOUT_MEDIUM } from '../../prisma/prisma.service';
import { ClubWechatJsapiService } from '../payments/club-wechat-jsapi.service';
import { ClubOrderPreviewBreakdownService } from '../orders/club-order-preview-breakdown.service';
import {
  awardPointsForSettlement,
  deductPointsForSettlement,
} from '../orders/club-order-settlement-points.utils';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { ClubVoucherOrderContextService } from './club-voucher-order-context.service';
import { ScanOrderingRealtimeService } from '../scan-ordering/scan-ordering-realtime.service';
import {
  buildVoucherCode,
  buildVoucherOrderNo,
} from './club-voucher-order-code.utils';
import {
  CLUB_VOUCHER_CUSTOMER_NOT_FOUND_MESSAGE,
  CLUB_VOUCHER_ORDER_NOT_FOUND_MESSAGE,
  CLUB_VOUCHER_STOCK_NOT_ENOUGH_MESSAGE,
} from './club-voucher-orders.constants';
import {
  CLUB_VOUCHER_DEFAULT_VALID_DAYS,
  CLUB_VOUCHER_GUEST_TYPE,
  CLUB_VOUCHER_PLATFORM,
} from './club-voucher-orders.types';
import type {
  ClubVoucherOrderResponseDto,
  CreateClubVoucherOrderDto,
} from './dto/club-voucher-order.dto';

/** 券码唯一冲突重试次数（唯一索引兜底，碰撞概率极低） */
const VOUCHER_CODE_RETRY_TIMES = 3;

/** 团购券订单状态字面量（与 Prisma 枚举同构，避免依赖 client 枚举导出） */
type VoucherOrderStatus =
  | 'unpaid'
  | 'pending'
  | 'used'
  | 'refunded'
  | 'expired';

/** 团购券订单草稿（unpaid）→ 响应结构 */
export interface ClubVoucherOrderDraftView {
  id: string;
  orderNo: string;
  status: VoucherOrderStatus;
  /** 支付成功后的团购券码 */
  voucherCode: string | null;
  amountFen: number;
  paymentParams?: {
    timeStamp: string;
    nonceStr: string;
    package: string;
    signType: string;
    paySign: string;
  };
}

@Injectable()
export class ClubVoucherOrderPaymentService {
  private readonly logger = new Logger(ClubVoucherOrderPaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clubVoucherOrderContextService: ClubVoucherOrderContextService,
    private readonly clubWechatJsapiService: ClubWechatJsapiService,
    private readonly breakdownService: ClubOrderPreviewBreakdownService,
    private readonly realtimeService: ScanOrderingRealtimeService,
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

    const now = Date.now();
    const orderNo = buildVoucherOrderNo(now);

    // 优惠拆解快照：与服务商品 preview 同口径（会员售价/等级折扣划线/活动折扣/满减/小计），
    // 订单详情页优惠清单在此基础上补充：原价行（划线）与积分抵扣行（订单使用积分时展示）
    const baseBreakdownItems = this.breakdownService.build({
      memberBaselineFen: pricing.memberAmountFen,
      originalPriceFen: pricing.originalAmountFen,
      discountAmountFen: pricing.discountAmountFen,
      promotionDiscountAmountFen: pricing.promotionDiscountFen,
      promotionType: pricing.promotionType,
      promotionTag: pricing.promotionTag,
      discountRate: pricing.discountRate,
      totalReduceFen: pricing.reduceFen,
      reduceRules: pricing.reduceRules,
      finalPriceFen: pricing.paidAmountFen + pricing.pointsDeductFen,
      memberDiscountRate: pricing.memberDiscountRate,
      memberWins: pricing.memberWins,
    });
    const toYuanText = (fen: number): string =>
      Money.fromDbCents(fen).toFixedOutputYuan();
    const breakdownItems = [
      // 原价行：划线表示原价已被会员价/活动覆盖
      {
        id: 'original-price',
        label: '原价',
        value: `¥${toYuanText(pricing.originalAmountFen)}`,
        isDeduction: false,
        isStrikethrough: true,
      },
      ...baseBreakdownItems,
      // 积分抵扣行：仅订单使用积分时展示（预览页积分由开关控制，不写入快照）
      ...(pricing.pointsDeductFen > 0
        ? [
            {
              id: 'points',
              label: '积分抵扣',
              value: `-¥${toYuanText(pricing.pointsDeductFen)}`,
              isDeduction: true,
              isStrikethrough: false,
            },
          ]
        : []),
    ];

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
      data: {
        platform: CLUB_VOUCHER_PLATFORM,
        storeId: context.store.id,
        userId: currentContext.user.id,
        customerId: context.customer.id,
        productId: context.product.id,
        productName: context.product.name,
        categoryName: context.product.categoryName,
        productPrice: context.product.price,
        productOriginalPrice: context.product.originalPrice,
        quantity,
        personCount,
        guestName: currentContext.user.name?.trim() || null,
        guestPhone: currentContext.user.phone,
        // 下单备注：仅去除首尾空白，空串归一为 null（商家端通知按空值不展示）
        remark: dto.remark?.trim() || null,
        guestType: CLUB_VOUCHER_GUEST_TYPE,
        orderNo,
        originalAmountFen: pricing.originalAmountFen,
        // 完整优惠口径 = 应付（原价） - 实付（含会员价差/活动/满减/积分），与服务详情页“共省”一致
        discountAmountFen: Math.max(
          pricing.originalAmountFen - pricing.paidAmountFen,
          0,
        ),
        paidAmountFen: pricing.paidAmountFen,
        breakdownItems: breakdownItems as unknown as Prisma.InputJsonValue,
        pointsDeductFen: pricing.pointsDeductFen,
        pointsUsed: pricing.pointsUsed,
        paymentChannel: paymentMethod,
        status: 'unpaid',
      },
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
          return { view: this.toDraftView(order), paidOrder: null };
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
          await this.settleBalancePayment(tx, order, order.customerId);
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
        const voucherCode = await this.generateUniqueVoucherCode(tx);

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
          view: this.toDraftView(updated),
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

    // 事务提交成功后才广播新订单事件，避免事务回滚导致商家端收到假通知
    if (paidOrder) {
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

  /**
   * 余额支付结算：储值余额扣款 + 消费流水 + 顾客指标（累计消费/到店次数/等级）+ 赠送消费积分
   * 与「服务订单余额结算」同口径：余额支付即门店消费，需记流水与累计消费
   */
  private async settleBalancePayment(
    tx: Prisma.TransactionClient,
    order: {
      storeId: number;
      orderNo: string;
      productName: string;
      paidAmountFen: number;
      pointsDeductFen: number;
    },
    customerId: number,
  ): Promise<void> {
    const customer = await tx.marketingCustomer.findFirst({
      where: { id: customerId, storeId: order.storeId, deletedAt: null },
      select: { id: true, totalSpent: true, balance: true },
    });
    if (!customer) {
      throw new BadRequestException(CLUB_VOUCHER_CUSTOMER_NOT_FOUND_MESSAGE);
    }

    // 余额扣减金额 = 订单实付金额（积分抵扣部分不占余额）
    const balancePaidFen = order.paidAmountFen;
    if (customer.balance < balancePaidFen) {
      throw new BadRequestException(
        `余额不足，当前余额 ¥${Money.fromDbCents(customer.balance).toFixedOutputYuan()}，需支付 ¥${Money.fromDbCents(balancePaidFen).toFixedOutputYuan()}`,
      );
    }

    // 消费流水：amount 含积分抵扣部分，反映消费总金额
    await tx.marketingConsumption.create({
      data: {
        storeId: order.storeId,
        customerId,
        amount: balancePaidFen + order.pointsDeductFen,
        balancePaid: balancePaidFen,
        pointsDeducted: order.pointsDeductFen,
        payType: 'balance',
        itemsSummary: order.productName,
        promotionId: null,
      },
    });

    // updateMany + where 条件保证余额不会被并发扣减为负数
    const newTotalSpent = customer.totalSpent + balancePaidFen;
    const updated = await tx.marketingCustomer.updateMany({
      where: { id: customerId, balance: { gte: balancePaidFen } },
      data: {
        balance: { decrement: balancePaidFen },
        totalSpent: { increment: balancePaidFen },
        visitCount: { increment: 1 },
        lastVisitAt: new Date(),
        tier: calcCustomerTier(newTotalSpent) as never,
      },
    });
    if (updated.count !== 1) {
      throw new BadRequestException(
        `余额不足或已被并发消费，当前余额无法支付 ¥${Money.fromDbCents(balancePaidFen).toFixedOutputYuan()}`,
      );
    }

    // 赠送消费积分（受积分规则 enabled 开关控制）
    await awardPointsForSettlement(
      tx,
      {
        storeId: order.storeId,
        description: order.productName,
        paidAmountFen: order.paidAmountFen,
      },
      customerId,
    );

    this.logger.log(
      `团购券余额支付结算: orderNo=${order.orderNo}, customerId=${customerId}, 扣款=${balancePaidFen}分`,
    );
  }

  /** 生成全局唯一券码（唯一索引冲突时重试） */
  private async generateUniqueVoucherCode(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    for (let attempt = 0; attempt < VOUCHER_CODE_RETRY_TIMES; attempt += 1) {
      const candidate = buildVoucherCode();
      const existing = await tx.clubVoucherOrder.findUnique({
        where: { voucherCode: candidate },
        select: { id: true },
      });
      if (!existing) {
        return candidate;
      }
    }
    throw new BadRequestException('券码生成失败，请重试');
  }

  /** 订单实体 → 草稿响应（金额单位分 → 元） */
  private toDraftView(order: {
    id: number;
    orderNo: string;
    status: VoucherOrderStatus;
    voucherCode: string | null;
    paidAmountFen: number;
  }): ClubVoucherOrderDraftView {
    return {
      id: order.orderNo,
      orderNo: order.orderNo,
      status: order.status,
      voucherCode: order.voucherCode,
      amountFen: order.paidAmountFen,
    };
  }
}

/** 支付完成后广播新订单事件所需的订单快照 */
export interface PaidVoucherOrderSnapshot {
  storeId: number;
  orderNo: string;
  voucherCode: string;
  guestName: string | null;
  guestPhone: string | null;
  productName: string;
  categoryName: string | null;
  quantity: number;
  /** 实付金额（分） */
  paidAmountFen: number;
  /** 下单备注（可空） */
  remark: string | null;
  createdAt: Date;
}
