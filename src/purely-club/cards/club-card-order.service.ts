/**
 * C 端购卡订单编排入口：下单 / 查单 / 取参 / 确认支付。
 *
 * 职责拆分（本服务只做场景编排，不碰落库细节）：
 * - 下单链路（幂等占位 + 预下单 + 落库 + 即时落账）在 ClubCardOrderCreateService；
 * - 订单读取（本人订单 / 幂等命中 / 重读 / 首张卡）在 ClubCardOrderReaderService；
 * - 落账事务本体在 ClubCardSettlementService，本服务只决定「谁在什么场景下可以触发落账」。
 *
 * 幂等的最后一层保障：`member_card_orders.transaction_id` 唯一索引，
 * 回调与手动确认双触发也只会落一次。
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { MemberCardOrder } from '@prisma/client';
import { ClubPaymentModeService } from '../payments/club-payment-mode.service';
import { ClubPrepayAttemptService } from '../payments/club-prepay-attempt.service';
import type { ClubPaymentCallbackSettlementParams } from '../payments/club-payments.types';
import { ClubWechatVerifyService } from '../payments/club-wechat-verify.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { ClubCardOrderCreateService } from './club-card-order-create.service';
import { ClubCardOrderReaderService } from './club-card-order-reader.service';
import { CLUB_CARD_ERROR_CODE, clubCardError } from './club-cards.errors';
import { ClubCardSettlementService } from './club-card-settlement.service';
import {
  CLUB_CARD_MANUAL_CONFIRM_DISABLED_MESSAGE,
  CLUB_CARD_ORDER_NOT_FOUND_MESSAGE,
  CLUB_CARD_PAY_WINDOW_MINUTES,
} from './club-cards.constants';
import { toOrderView } from './club-cards.mapper';
import type {
  ClubMemberCardOrderView,
  ClubMemberCardSettlementResult,
} from './club-cards.types';
import type { CreateClubCardOrderDto } from './dto/club-cards.dto';
import type { ClubOrderPaymentParamsResponseDto } from '../orders/dto/club-order.dto';

@Injectable()
export class ClubCardOrderService {
  constructor(
    private readonly createService: ClubCardOrderCreateService,
    private readonly readerService: ClubCardOrderReaderService,
    private readonly paymentModeService: ClubPaymentModeService,
    private readonly settlementService: ClubCardSettlementService,
    private readonly wechatVerifyService: ClubWechatVerifyService,
    private readonly prepayAttemptService: ClubPrepayAttemptService,
  ) {}

  /** 创建购卡订单（详见 ClubCardOrderCreateService.createOrder） */
  async createOrder(
    currentContext: ClubCurrentContext,
    dto: CreateClubCardOrderDto,
    idempotencyKey?: string,
  ): Promise<ClubMemberCardOrderView> {
    return this.createService.createOrder(currentContext, dto, idempotencyKey);
  }

  /**
   * 查询购卡订单状态。
   *
   * `verify=true` 时先回微信侧核对并补落账，再读本地状态：
   * 前端在拉起支付后结果未知（unknown）时必须用它确认是否已扣款。
   */
  async getOrderStatus(
    currentContext: ClubCurrentContext,
    orderId: string,
    query?: { verify?: boolean },
  ): Promise<ClubMemberCardOrderView> {
    const order = await this.readerService.findOwnedOrder(
      currentContext,
      orderId,
    );

    // 只有真的发生了落账，库内状态才可能变化；否则复用已读订单，
    // 省掉前端轮询 getOrderStatus 时每次一次的整行重读。
    let latest = order;
    if (query?.verify === true && order.status === 'unpaid') {
      const verified = await this.wechatVerifyService.confirmPaidOnWechat({
        scope: 'card',
        storeId: order.storeId,
        outTradeNo: order.orderNo,
        expectedAmountFen: order.amount,
      });
      if (verified) {
        await this.settlementService.settlePaidOrder(
          order.id,
          order.amount,
          verified,
        );
        latest = await this.readerService.reloadOrder(order.id);
      }
    }

    return toOrderView({
      order: latest,
      cardId: await this.readerService.findFirstCardId(latest.id),
    });
  }

  /**
   * 按需取支付参数（建单 prepay=false 时由前端单独调用）。
   *
   * 与建单解耦后：微信变慢只影响「拉起收银台」这一步，订单已经落好，
   * 失败可原样重试而不会重复建单、不会重复占用限购额度。
   */
  async createOrderPaymentParams(
    currentContext: ClubCurrentContext,
    orderId: string,
    openid?: string,
  ): Promise<ClubOrderPaymentParamsResponseDto> {
    const order = await this.readerService.findOwnedOrder(
      currentContext,
      orderId,
    );
    this.assertOrderPayable(order);

    const result = await this.prepayAttemptService.createPaymentParams({
      baseOrderNo: order.orderNo,
      storeId: order.storeId,
      description: `购买${order.planNameSnapshot}`,
      amountFen: order.amount,
      userId: currentContext.user.id,
      openid,
      buildError: (reason) =>
        reason === 'in_flight'
          ? new ConflictException(
              clubCardError(
                CLUB_CARD_ERROR_CODE.STATUS_PAYMENT_IN_FLIGHT,
                '支付请求正在处理中，请稍后重试',
              ),
            )
          : new ConflictException(
              clubCardError(
                CLUB_CARD_ERROR_CODE.STATUS_PAYMENT_ATTEMPT_EXHAUSTED,
                '支付尝试次数过多，请重新下单',
              ),
            ),
    });

    return { orderNo: order.orderNo, ...result };
  }

  /**
   * 取参前置校验：只有「微信支付 + 仍待支付 + 未过期 + 有应付金额」的订单才需要取参。
   *
   * 余额 / 零元卡在下单请求内已直接落账发卡，再来取参只会拿到一张废参数。
   */
  private assertOrderPayable(order: MemberCardOrder): void {
    if (order.status !== 'unpaid') {
      throw new ConflictException(
        clubCardError(
          CLUB_CARD_ERROR_CODE.STATUS_SETTLEMENT_NOT_ALLOWED,
          '订单当前状态不可发起支付',
        ),
      );
    }
    if (order.paymentChannel !== null && order.paymentChannel !== 'wechat') {
      throw new BadRequestException(
        clubCardError(
          CLUB_CARD_ERROR_CODE.RULE_PAYMENT_NOT_REQUIRED,
          '该订单不走微信支付，无需获取支付参数',
        ),
      );
    }
    if (order.amount <= 0) {
      throw new BadRequestException(
        clubCardError(
          CLUB_CARD_ERROR_CODE.RULE_PAYMENT_NOT_REQUIRED,
          '该订单无需支付',
        ),
      );
    }

    const expiresAt = this.resolveOrderExpiresAt(order);
    if (expiresAt.getTime() <= Date.now()) {
      throw new ConflictException(
        clubCardError(
          CLUB_CARD_ERROR_CODE.STATUS_SETTLEMENT_NOT_ALLOWED,
          '订单已超时关闭，请重新下单',
        ),
      );
    }
  }

  /** 待支付窗口：历史单据可能没有 expiresAt，用创建时间 + 支付窗口还原 */
  private resolveOrderExpiresAt(order: MemberCardOrder): Date {
    return (
      order.expiresAt ??
      new Date(
        order.createdAt.getTime() + CLUB_CARD_PAY_WINDOW_MINUTES * 60_000,
      )
    );
  }

  /**
   * 用户端确认支付成功（开发态兜底）。
   *
   * 生产环境恒不可用：否则任何拿到订单号的人都能把未支付订单标记成已支付，
   * 白拿一张卡。资金闸门统一由 ClubPaymentModeService 裁决。
   */
  async confirmOrderPaid(
    currentContext: ClubCurrentContext,
    orderId: string,
  ): Promise<ClubMemberCardOrderView> {
    const manualConfirmPaidAllowed =
      await this.paymentModeService.isManualConfirmPaidAllowed();
    if (!manualConfirmPaidAllowed) {
      throw new ForbiddenException(
        clubCardError(
          CLUB_CARD_ERROR_CODE.RULE_MANUAL_CONFIRM_DISABLED,
          CLUB_CARD_MANUAL_CONFIRM_DISABLED_MESSAGE,
        ),
      );
    }

    const order = await this.readerService.findOwnedOrder(
      currentContext,
      orderId,
    );
    // 测试落账统一用 `dev-` 前缀交易号，对账侧可据此排除测试订单
    const settlement = await this.settlementService.settlePaidOrder(
      order.id,
      order.amount,
      {
        transactionId: `dev-${order.orderNo}`,
        paidAtMs: Date.now(),
        callbackReceivedAtMs: Date.now(),
      },
    );

    return toOrderView({
      order: await this.readerService.reloadOrder(order.id),
      cardId: settlement.cardId === null ? null : String(settlement.cardId),
    });
  }

  /** 微信支付回调确认支付成功：校验金额后按订单号落账（幂等） */
  async confirmOrderPaidByCallback(
    orderNo: string,
    params: ClubPaymentCallbackSettlementParams,
  ): Promise<ClubMemberCardSettlementResult> {
    const order = await this.readerService.findByOrderNo(orderNo);
    if (!order) {
      throw new BadRequestException(
        clubCardError(
          CLUB_CARD_ERROR_CODE.RESOURCE_ORDER_NOT_FOUND,
          CLUB_CARD_ORDER_NOT_FOUND_MESSAGE,
        ),
      );
    }
    if (order.amount !== params.amountFen) {
      // 金额不符绝不落账：宁可留待人工核对，也不能按错误金额发卡
      throw new BadRequestException(
        clubCardError(
          CLUB_CARD_ERROR_CODE.RULE_AMOUNT_MISMATCH,
          '回调金额与订单金额不一致',
        ),
      );
    }

    const settlement = await this.settlementService.settlePaidOrder(
      order.id,
      order.amount,
      params,
    );
    return {
      orderNo: order.orderNo,
      orderType: 'card',
      status: 'paid',
      settled: settlement.settled,
      cardId: settlement.cardId,
    };
  }
}
