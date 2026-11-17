import { CLUB_PAY_ERROR_CODE, clubPayError } from './club-pay.errors';
import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService, TX_TIMEOUT_MEDIUM } from '../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../redis/invalidator';
import { ClubOrderDraftsService } from '../orders/club-order-drafts.service';
import type {
  ClubOrderDraftPayload,
  ClubOrderPaidObservationOptions,
} from '../orders/club-order-drafts.types';
import type { ClubOrderStatusResponseDto } from '../orders/dto/club-order.dto';
import type { ClubOrderTypeValue } from '../orders/club-order.types';
import { ClubPaymentLockService } from './club-payment-lock.service';
import { shouldRefreshPaidObservation } from './club-payments.utils';

const CLUB_PAYMENT_ALREADY_PROCESSING_MESSAGE = '订单正在处理中，请勿重复操作';

export abstract class ClubPaymentSettlementTemplate<
  TMetadata extends object,
  TOrderType extends ClubOrderTypeValue,
  TResult,
> {
  protected readonly logger = new Logger(ClubPaymentSettlementTemplate.name);

  protected constructor(
    protected readonly prisma: PrismaService,
    protected readonly clubOrderDraftsService: ClubOrderDraftsService,
    protected readonly cacheInvalidatorService: CacheInvalidatorService,
    protected readonly paymentLockService: ClubPaymentLockService,
  ) {}

  async completePaidDraft(
    draft: ClubOrderDraftPayload<TMetadata, TOrderType>,
    paymentMeta?: ClubOrderPaidObservationOptions,
  ): Promise<TResult> {
    if (draft.status === 'paid') {
      const observedPaidDraft = shouldRefreshPaidObservation(paymentMeta)
        ? await this.clubOrderDraftsService.markPaid(draft, paymentMeta)
        : draft;
      return this.toResponse(observedPaidDraft);
    }

    this.assertDraftPayable(draft.status);

    if (!draft.customerId) {
      throw new NotFoundException(
        clubPayError(
          CLUB_PAY_ERROR_CODE.RESOURCE_MEMBER_NOT_FOUND,
          this.memberNotFoundMessage,
        ),
      );
    }

    // 获取分布式锁，防止并发回调/重复 confirm 导致重复落账
    const lockToken = await this.paymentLockService.acquireLock(draft.orderNo);
    if (!lockToken) {
      this.logger.warn(
        `订单 ${draft.orderNo} 正在被并发处理，拒绝本次落账请求`,
      );
      throw new BadRequestException(
        clubPayError(
          CLUB_PAY_ERROR_CODE.STATUS_ALREADY_PROCESSING,
          CLUB_PAYMENT_ALREADY_PROCESSING_MESSAGE,
        ),
      );
    }

    try {
      // 门店级只读规则在事务外并行预加载，避免占用交互式事务的单连接并缩短持锁时间
      const rules = await this.preloadSettlementRules(draft);
      await this.prisma.$transaction(
        async (tx) => {
          await this.persistPaidDraft(tx, draft, rules);
        },
        { timeout: TX_TIMEOUT_MEDIUM },
      );
      // 两份失效互不依赖，合并为并行：
      //  - invalidateMarketingCustomerDerived：顾客列表 / 详情（商家端 60s / 15s TTL）
      //  - invalidateMembersDerived：会员中心「可用积分 / 最近活跃」的事实源
      //    （落账会改 marketing_customers 的 points / balance / lastVisitAt）
      // 原先串行等待两次 Redis 往返，落账回调路径上纯属叠加延迟。
      // 失效失败不影响落账成功（事务已提交）：各自 catch 后只记 warn，
      // 最坏结果是缓存留在 TTL 内，不能让一个 Redis 抖动导致支付回调重试。
      await Promise.all([
        this.invalidateSafely(
          'invalidateMarketingCustomerDerived',
          draft.orderNo,
          () =>
            this.cacheInvalidatorService.invalidateMarketingCustomerDerived(
              draft.storeId,
            ),
        ),
        this.invalidateSafely('invalidateMembersDerived', draft.orderNo, () =>
          this.cacheInvalidatorService.invalidateMembersDerived(draft.storeId),
        ),
      ]);

      const paidDraft = await this.clubOrderDraftsService.markPaid(
        draft,
        paymentMeta,
      );
      return this.toResponse(paidDraft);
    } finally {
      await this.paymentLockService.releaseLock(draft.orderNo, lockToken);
    }
  }

  /**
   * 缓存失效的容错包装：失败只记 warn。
   *
   * 落账事务已提交，失效只是「让新值尽快可见」的加速动作；把它的失败
   * 冒泡成 5xx 会让支付回调被微信重投，而重投本身又要再走一遍落账锁。
   */
  private async invalidateSafely(
    operation: string,
    orderNo: string,
    run: () => Promise<void>,
  ): Promise<void> {
    try {
      await run();
    } catch (error) {
      this.logger.warn(
        `落账后缓存失效失败 operation=${operation} orderNo=${orderNo}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  protected abstract readonly memberNotFoundMessage: string;

  protected abstract assertDraftPayable(
    status: ClubOrderStatusResponseDto['status'],
  ): void;

  /**
   * 事务外预加载门店级只读规则（等级阈值 / 积分规则等）。
   *
   * 基类默认不预加载；需要规则快照的子类 override，结果经第三个参数透传给
   * persistPaidDraft。返回 unknown 是为了让模板不依赖任何具体业务配置类型。
   */
  protected preloadSettlementRules(
    draft: ClubOrderDraftPayload<TMetadata, TOrderType>,
  ): Promise<unknown> {
    void draft;
    return Promise.resolve(undefined);
  }

  protected abstract persistPaidDraft(
    tx: Prisma.TransactionClient,
    draft: ClubOrderDraftPayload<TMetadata, TOrderType>,
    rules?: unknown,
  ): Promise<void>;

  protected abstract toResponse(
    draft: ClubOrderDraftPayload<TMetadata, TOrderType>,
  ): TResult;
}
