/**
 * 购卡订单落账事务：unpaid → pending（原子抢占）→ 建卡实例 + purchase 流水 → paid。
 *
 * 单独成服务的原因：
 * - 回调（ClubCardOrderService.confirmOrderPaidByCallback）、手动确认、
 *   回源核对三条入口必须走**同一段**事务逻辑，否则幂等闸门形同虚设；
 * - 事务与缓存失效是独立职责，和下单 / 查单的读写编排分开更好维护。
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CLUB_CARD_ERROR_CODE, clubCardError } from './club-cards.errors';
import { PrismaService, TX_TIMEOUT_MEDIUM } from '../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../redis/invalidator';
import { resolveCardExpiresAt } from '../../purely-profit/member/cards/member-card.utils';
import { assertClubPaymentAmountMatchesAllowZero } from '../payments/club-payments.utils';
import { buildCardNo } from './club-card-code.utils';
import { settleCardBalancePayment } from './club-card-balance-settlement.helper';
import {
  CLUB_CARD_ORDER_NOT_FOUND_MESSAGE,
  buildClubCardBalanceTransactionId,
} from './club-cards.constants';

/** 落账入参（回调 / 手动确认 / 微信侧核对统一结构） */
export interface ClubCardSettleParams {
  transactionId?: string;
  paidAtMs?: number;
  callbackReceivedAtMs?: number;
}

/** 落账结果：settled=false 表示幂等命中（订单此前已支付） */
export interface ClubCardSettleOutcome {
  settled: boolean;
  cardId: number | null;
  storeId: number;
}

/** 落账统一入参：微信链路带期望金额，余额支付以库内订单金额为准 */
interface ClubCardSettlementInput {
  orderId: number;
  /** 微信回调 / 手动确认携带的期望金额（分）；余额支付不传 */
  expectedAmountFen?: number;
  params?: ClubCardSettleParams;
  /** 余额支付：在同一事务内扣减储值余额并记消费流水 */
  viaBalance?: boolean;
}

@Injectable()
export class ClubCardSettlementService {
  private readonly logger = new Logger(ClubCardSettlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
  ) {}

  /**
   * 执行落账（微信链路）。
   *
   * 幂等闸门：`updateMany({ where: { status: 'unpaid' } })` 等价于
   * 「当前读 + 行级写锁」——并发的第二笔会阻塞到第一笔提交后重新判定条件，
   * count=0 即说明已被结算。因此回调重投、手动确认双触发都只会发一次卡。
   */
  async settlePaidOrder(
    orderId: number,
    expectedAmountFen: number,
    params?: ClubCardSettleParams,
  ): Promise<ClubCardSettleOutcome> {
    return this.runSettlement({ orderId, expectedAmountFen, params });
  }

  /**
   * 余额支付落账：与微信落账共用同一段事务（抢占 → 发卡），
   * 区别只在事务内先扣减储值余额并记消费流水。
   *
   * 金额一律以库内订单为准：余额支付没有第三方对账金额可比，
   * 由扣款侧的条件更新（balance >= amount）保证不会扣成负数。
   */
  async settlePaidOrderByBalance(
    orderId: number,
  ): Promise<ClubCardSettleOutcome> {
    return this.runSettlement({ orderId, viaBalance: true });
  }

  /** 落账事务本体：微信 / 余额两条链路共用，避免幂等闸门出现第二份实现 */
  private async runSettlement(
    input: ClubCardSettlementInput,
  ): Promise<ClubCardSettleOutcome> {
    const { orderId, expectedAmountFen, params } = input;
    const outcome = await this.prisma.$transaction(
      async (tx): Promise<ClubCardSettleOutcome> => {
        const order = await tx.memberCardOrder.findUnique({
          where: { id: orderId },
        });
        if (!order) {
          throw new NotFoundException(
            clubCardError(
              CLUB_CARD_ERROR_CODE.RESOURCE_ORDER_NOT_FOUND,
              CLUB_CARD_ORDER_NOT_FOUND_MESSAGE,
            ),
          );
        }
        // 零元卡（0 元购 / 赠送）金额为 0 属合法场景，
        // 必须用允许 0 元的版本，否则免费卡永远无法落账
        if (expectedAmountFen !== undefined) {
          assertClubPaymentAmountMatchesAllowZero(
            order.amount,
            expectedAmountFen,
          );
        }

        // 余额支付没有微信流水号，用固定前缀交易号留痕，对账侧可与真实流水区分
        const transactionId =
          params?.transactionId ??
          (input.viaBalance === true
            ? buildClubCardBalanceTransactionId(order.orderNo)
            : undefined);

        const claimed = await tx.memberCardOrder.updateMany({
          where: { id: orderId, status: 'unpaid' },
          data: {
            status: 'pending',
            ...(transactionId ? { transactionId } : {}),
            ...(params?.callbackReceivedAtMs
              ? { callbackReceivedAt: new Date(params.callbackReceivedAtMs) }
              : {}),
          },
        });

        if (claimed.count !== 1) {
          const current = await tx.memberCardOrder.findUnique({
            where: { id: orderId },
            select: {
              status: true,
              cards: { select: { id: true }, orderBy: { id: 'asc' }, take: 1 },
            },
          });
          if (current?.status !== 'paid') {
            // 订单已取消 / 关闭却收到支付回调：不能静默成功（钱收了没卡），
            // 抛出后由死信链路留下可人工退款的记录
            throw new ConflictException(
              clubCardError(
                CLUB_CARD_ERROR_CODE.STATUS_SETTLEMENT_NOT_ALLOWED,
                `购卡订单状态 ${current?.status ?? 'unknown'} 不允许落账`,
              ),
            );
          }
          return {
            settled: false,
            cardId: current.cards[0]?.id ?? null,
            storeId: order.storeId,
          };
        }

        const plan = await tx.memberCardPlan.findUnique({
          where: { id: order.planId },
          select: { validDays: true, totalTimes: true },
        });
        if (!plan) {
          throw new BadRequestException(
            clubCardError(
              CLUB_CARD_ERROR_CODE.RESOURCE_PLAN_NOT_FOUND,
              '卡模板已不存在，无法发卡',
            ),
          );
        }

        // 余额支付：扣款必须与发卡同事务，避免「钱扣了没有卡」
        if (input.viaBalance === true) {
          await settleCardBalancePayment(tx, order, order.customerId);
        }

        const paidAt = params?.paidAtMs
          ? new Date(params.paidAtMs)
          : new Date();
        // 有效期从支付成功起算：用户先付款后到店，不能从下单时间开始跑。
        // 到期时间必须与商家端持卡口径一致（上海时区第 validDays 天 23:59:59.999），
        // 禁止用 UTC 直接加天数，否则同一档卡在两端会差最多一天
        const expiresAt = resolveCardExpiresAt(
          paidAt.getTime(),
          plan.validDays,
        );
        // 次数卡的 totalTimes 是发卡时的权威值；时长卡一律 null
        const totalTimes =
          order.kind === 'times' ? (plan.totalTimes ?? 0) : null;

        let firstCardId: number | null = null;
        for (let index = 0; index < order.quantity; index += 1) {
          const card = await tx.memberCard.create({
            data: {
              storeId: order.storeId,
              planId: order.planId,
              cardNo: buildCardNo(order.orderNo, index),
              kind: order.kind,
              nameSnapshot: order.planNameSnapshot,
              customerId: order.customerId,
              status: 'active',
              startsAt: paidAt,
              expiresAt,
              totalTimes,
              usedTimes: totalTimes === null ? null : 0,
              remainTimes: totalTimes,
              pricePaid: order.unitAmount,
              sourceType: 'club_order',
              orderId: order.id,
            },
            select: { id: true },
          });

          // 办卡流水：append-only，后续核销 / 释放都追加新行，绝不改写这一条
          await tx.memberCardTransaction.create({
            data: {
              storeId: order.storeId,
              cardId: card.id,
              changeType: 'purchase',
              status: 'done',
              deltaTimes: totalTimes ?? 0,
              beforeTimes: totalTimes === null ? null : 0,
              afterTimes: totalTimes,
              relatedOrderId: order.id,
              operatorType: 'club',
              remark: 'C 端购卡开通',
            },
          });

          firstCardId ??= card.id;
        }

        await tx.memberCardOrder.update({
          where: { id: orderId },
          data: {
            status: 'paid',
            paidAt,
            ...(params?.transactionId
              ? { transactionId: params.transactionId }
              : {}),
            ...(params?.callbackReceivedAtMs
              ? { callbackReceivedAt: new Date(params.callbackReceivedAtMs) }
              : {}),
          },
        });

        this.logger.log(
          `购卡订单支付成功: orderNo=${order.orderNo}, 发卡 ${order.quantity} 张, expiresAt=${expiresAt.toISOString()}`,
        );

        return { settled: true, cardId: firstCardId, storeId: order.storeId };
      },
      { timeout: TX_TIMEOUT_MEDIUM },
    );

    if (outcome.settled) {
      // 卡包与顾客详情是商家端营销衍生数据，落账后必须失效，
      // 否则商家端要等缓存 TTL 才看得到新卡
      await this.cacheInvalidatorService.invalidateMarketingCustomerDerived(
        outcome.storeId,
      );
      // 无主档案补绑必须在提交后执行：它是读侧归因修正，不能让事务因唯一约束冲突回滚
      await this.bindPurchasedCustomerToClubUser(orderId);
    }

    return outcome;
  }

  /**
   * 把本次购卡所用的顾客档案补绑到下单的 C 端用户。
   *
   * 下单侧允许按手机号降级落到「无主档案」（clubUserId = null），而卡包 / 卡详情只按
   * clubUserId 聚合本人档案——不补绑就会出现「钱付了、卡发了，卡包里却没有这张卡」。
   * 因此落账成功后必须把这条档案的归属补齐，让下单口径与查询口径重新对齐。
   */
  private async bindPurchasedCustomerToClubUser(
    orderId: number,
  ): Promise<void> {
    try {
      const order = await this.prisma.memberCardOrder.findUnique({
        where: { id: orderId },
        select: {
          orderNo: true,
          storeId: true,
          customerId: true,
          clubUserId: true,
        },
      });
      if (!order || order.clubUserId === null) {
        return;
      }

      const customer = await this.prisma.marketingCustomer.findUnique({
        where: { id: order.customerId },
        select: { id: true, clubUserId: true, deletedAt: true },
      });
      if (
        !customer ||
        customer.clubUserId !== null ||
        customer.deletedAt !== null
      ) {
        return;
      }

      // 该门店已有本人绑定档案时不抢绑，避免撞 uq_marketing_customers_store_club_user
      const bound = await this.prisma.marketingCustomer.findFirst({
        where: {
          storeId: order.storeId,
          clubUserId: order.clubUserId,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (bound) {
        return;
      }

      // 条件更新兜底并发：另一个请求已把 clubUserId 写进去时不再覆盖
      const updated = await this.prisma.marketingCustomer.updateMany({
        where: { id: customer.id, clubUserId: null },
        data: { clubUserId: order.clubUserId },
      });
      if (updated.count === 0) {
        return;
      }

      this.logger.log(
        `购卡补绑顾客档案: orderNo=${order.orderNo}, customerId=${customer.id}, clubUserId=${order.clubUserId}`,
      );
    } catch (error) {
      // 补绑只影响卡包可见性，不能让已完成的落账报错；失败可凭日志人工修复
      this.logger.warn(
        `购卡补绑顾客档案失败: orderId=${orderId}, reason=${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
