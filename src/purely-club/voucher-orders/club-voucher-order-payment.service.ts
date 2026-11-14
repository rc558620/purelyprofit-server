// 团购券订单支付服务：创建订单草稿（JSAPI 下单 / 余额直接结算）→ 委托支付确认落账
//
// 职责边界：本文件只负责**下单编排**——幂等闸门、草稿落库、失败回滚与复用。
// 「算价与支付意图」在 ClubVoucherOrderDraftService，
// 「支付成功落账」在 ClubVoucherOrderSettlementService。
// 对外方法签名保持不变，controller / 回调 / 队列调用点零改动。
import { ConflictException, Injectable } from '@nestjs/common';
import {
  CLUB_VOUCHER_ERROR_CODE,
  clubVoucherError,
} from './club-voucher-orders.errors';
import { Prisma } from '@prisma/client';
import { PrismaService, TX_TIMEOUT_MEDIUM } from '../../prisma/prisma.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { ClubOrderIdempotencyService } from '../shared/club-order-idempotency.service';
import { ClubVoucherOrderDraftService } from './club-voucher-order-draft.service';
import type {
  VoucherOrderDraftPlan,
  VoucherOrderDraftPreparation,
} from './club-voucher-order-draft.service';
import { buildVoucherOrderCreateInput } from './club-voucher-order-payment.helper';
import type { ClubVoucherOrderDraftView } from './club-voucher-order-payment.types';
import { ClubVoucherOrderSettlementService } from './club-voucher-order-settlement.service';
import type {
  ClubVoucherOrderResponseDto,
  CreateClubVoucherOrderDto,
} from './dto/club-voucher-order.dto';

/** 团购券订单的幂等作用域（与服务购买订单区分开） */
const VOUCHER_ORDER_IDEMPOTENCY_SCOPE = 'club:voucher-order:create';

@Injectable()
export class ClubVoucherOrderPaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotencyService: ClubOrderIdempotencyService,
    private readonly draftService: ClubVoucherOrderDraftService,
    private readonly settlementService: ClubVoucherOrderSettlementService,
  ) {}

  /** 创建团购券订单草稿：校验商品/算价 → JSAPI 下单 → 落库 unpaid */
  async createVoucherOrder(
    currentContext: ClubCurrentContext,
    dto: CreateClubVoucherOrderDto,
    idempotencyKey?: string,
  ): Promise<ClubVoucherOrderResponseDto> {
    const idempotency = this.idempotencyService.normalizeKey(idempotencyKey);

    // 重复提交（双击 / 网络重试）一律复用已建订单：团购券订单会扣库存与新客额度，
    // 同一笔意图绝不能再建一单。数据库 (user_id, idempotency_key) 唯一键是最终兜底，
    // 这里先查一次，绝大多数重复请求连算价与微信下单都不会走到。
    if (idempotency) {
      const existing = await this.findReusableOrder(
        currentContext.user.id,
        idempotency,
      );
      if (existing) {
        return existing;
      }
    }

    const plan = await this.draftService.prepare(currentContext, dto);

    // 并发双击：同一幂等键只允许一笔真正落库
    if (idempotency) {
      const occupied = await this.reserveIdempotency(
        currentContext.user.id,
        idempotency,
        plan.draft.orderNo,
      );
      if (occupied) {
        return occupied;
      }
    }

    return this.persistOrder(currentContext, plan, idempotency);
  }

  /** 用户端确认支付成功（开发态兜底）：闸门与落账由结算服务裁决 */
  confirmOrderPaid(
    currentContext: ClubCurrentContext,
    orderNo: string,
  ): Promise<ClubVoucherOrderDraftView> {
    return this.settlementService.confirmOrderPaid(currentContext, orderNo);
  }

  /** 微信回调确认支付成功：按订单号路由，校验金额后完成落账 */
  confirmOrderPaidByCallback(
    orderNo: string,
    params: { amountFen: number; transactionId?: string; paidAtMs?: number },
  ): Promise<ClubVoucherOrderDraftView> {
    return this.settlementService.confirmOrderPaidByCallback(orderNo, params);
  }

  // ─── 幂等闸门 ─────────────────────────────────────────────────────────────

  /**
   * 占位幂等键。
   *
   * 返回非空表示「对方已占位且能查到订单」，直接复用；查不到则抛 409，
   * 让用户去订单列表确认，而不是再发一次下单。
   */
  private async reserveIdempotency(
    userId: number,
    idempotency: string,
    orderNo: string,
  ): Promise<ClubVoucherOrderResponseDto | null> {
    const occupiedOrderNo = await this.idempotencyService.reserve({
      scope: VOUCHER_ORDER_IDEMPOTENCY_SCOPE,
      userId,
      key: idempotency,
      orderNo,
    });
    if (!occupiedOrderNo || occupiedOrderNo === orderNo) {
      return null;
    }

    // 并发重复提交：对方已占位，优先返回对方那笔（已提交则能查到）
    const occupied = await this.findReusableOrder(userId, idempotency);
    if (occupied) {
      return occupied;
    }
    throw new ConflictException(
      clubVoucherError(
        CLUB_VOUCHER_ERROR_CODE.STATUS_ORDER_PROCESSING,
        '订单正在处理，请稍后在订单列表查看',
      ),
    );
  }

  /** 释放幂等占位；失败只会让对方多等一个 TTL，不影响已抛出的业务错误 */
  private async releaseIdempotency(
    userId: number,
    idempotency: string,
  ): Promise<void> {
    try {
      await this.idempotencyService.release({
        scope: VOUCHER_ORDER_IDEMPOTENCY_SCOPE,
        userId,
        key: idempotency,
      });
    } catch {
      // 吞掉即可：占位会随 TTL 自动过期
    }
  }

  // ─── 落库与复用 ───────────────────────────────────────────────────────────

  /** 落库 unpaid 草稿（含额度扣减），余额支付则在同一请求内完成结算 */
  private async persistOrder(
    currentContext: ClubCurrentContext,
    plan: VoucherOrderDraftPlan,
    idempotency: string | null,
  ): Promise<ClubVoucherOrderResponseDto> {
    try {
      const created = await this.createOrderRecord(
        currentContext,
        plan.draft,
        idempotency,
      );

      // 余额支付：同一请求内完成落账（扣余额 + 生成券码 + 扣库存 + 起算有效期）
      if (plan.draft.paymentMethod === 'balance') {
        const view = await this.settlementService.completePayment(
          created.id,
          plan.draft.pricing.paidAmountFen,
        );
        return this.toPaidResponse(view);
      }

      return {
        id: plan.draft.orderNo,
        orderNo: plan.draft.orderNo,
        status: 'unpaid',
        amountFen: plan.draft.pricing.paidAmountFen,
        paymentParams: plan.paymentParams,
      };
    } catch (error) {
      // 唯一键兜底命中：说明并发的另一笔请求已经提交成功，直接返回它，
      // 不能把「重复提交」报成 500，也不能让用户看到两笔订单
      if (idempotency && this.isUniqueConstraintError(error)) {
        const duplicated = await this.findReusableOrder(
          currentContext.user.id,
          idempotency,
        );
        if (duplicated) {
          return duplicated;
        }
      }

      // 建单失败必须释放幂等占位，否则用户 15 分钟内用同一个键重试只会被 409 拦住
      if (idempotency) {
        await this.releaseIdempotency(currentContext.user.id, idempotency);
      }
      throw error;
    }
  }

  /**
   * 订单落库与额度扣减必须在同一事务：扣不到额度（并发下被别人抢走最后一个）就回滚，
   * 保证「服务的新客数」严格等于「扣掉的额度」。老客在扣减处直接放行。
   * 余额结算刻意留在事务外——它自带事务且要发实时通知。
   */
  private createOrderRecord(
    currentContext: ClubCurrentContext,
    draft: VoucherOrderDraftPreparation,
    idempotency: string | null,
  ): Promise<{ id: number }> {
    return this.prisma.$transaction(
      async (tx) => {
        const order = await tx.clubVoucherOrder.create({
          data: {
            ...buildVoucherOrderCreateInput({
              orderNo: draft.orderNo,
              storeId: draft.context.store.id,
              userId: currentContext.user.id,
              customerId: draft.context.customer.id,
              product: draft.context.product,
              guestName: draft.guestName,
              guestPhone: draft.guestPhone,
              quantity: draft.quantity,
              personCount: draft.personCount,
              remark: draft.remark,
              pricing: draft.pricing,
              breakdownItems: draft.breakdownItems,
              paymentMethod: draft.paymentMethod,
            }),
            // 幂等键随单落库，(user_id, idempotency_key) 唯一键是并发兜底
            idempotencyKey: idempotency,
          },
          select: { id: true },
        });

        await this.quotaConsume(tx, currentContext, draft);

        return order;
      },
      { timeout: TX_TIMEOUT_MEDIUM },
    );
  }

  /** 新客额度扣减：与订单落库同事务，扣不到就整单回滚 */
  private quotaConsume(
    tx: Prisma.TransactionClient,
    currentContext: ClubCurrentContext,
    draft: VoucherOrderDraftPreparation,
  ): Promise<void> {
    return this.draftService.consumeQuotaWithinTransaction(
      tx,
      draft.context.store.id,
      currentContext.user.id,
      currentContext.user.phone || null,
    );
  }

  /** 已落账订单 → 下单响应（余额支付直接返回券码） */
  private toPaidResponse(
    view: ClubVoucherOrderDraftView,
  ): ClubVoucherOrderResponseDto {
    return {
      id: view.id,
      orderNo: view.orderNo,
      voucherCode: view.voucherCode ?? undefined,
      status: view.status,
      amountFen: view.amountFen,
    };
  }

  /**
   * 按幂等键找已创建的订单并组装复用响应。
   *
   * 复用响应刻意不带支付参数：微信同一 out_trade_no 不能重复下单，
   * 前端拿到 reused=true 时应当引导用户去订单列表继续支付或查看，
   * 而不是再次调起收银台。
   */
  private async findReusableOrder(
    userId: number,
    idempotencyKey: string,
  ): Promise<ClubVoucherOrderResponseDto | null> {
    const order = await this.prisma.clubVoucherOrder.findFirst({
      where: { userId, idempotencyKey },
      select: {
        orderNo: true,
        status: true,
        paidAmountFen: true,
        voucherCode: true,
      },
    });

    if (!order) {
      return null;
    }

    return {
      id: order.orderNo,
      orderNo: order.orderNo,
      voucherCode: order.voucherCode ?? undefined,
      status: order.status,
      amountFen: order.paidAmountFen,
      reused: true,
    };
  }

  /** 是否命中唯一约束（P2002）：并发重复提交的唯一兜底信号 */
  private isUniqueConstraintError(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}
