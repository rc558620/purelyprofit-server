import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { RedisService } from '../../redis/redis.service';
import type {
  ClubOrderStatusResponseDto,
  ClubServiceOrderResponseDto,
  ClubWechatPaymentParamsDto,
} from './dto/club-order.dto';
import type { ClubOrderTypeValue } from './club-order.types';
import type {
  ClubOrderDraftPayload,
  ClubOrderPaidObservationOptions,
  ClubServiceOrderMetadata,
} from './club-order-drafts.types';
import {
  buildDraftKey,
  buildPaidDraft,
  CLUB_ORDER_DRAFT_TTL_SECONDS,
  createDraftPayload,
  isSamePaidObservation,
  normalizeDraft,
  toOrderStatusResponse,
  toServiceOrderResponse,
} from './club-order-drafts.utils';

@Injectable()
export class ClubOrderDraftsService {
  constructor(private readonly redisService: RedisService) {}

  async createDraft<
    TMetadata extends object = Record<string, unknown>,
    TOrderType extends ClubOrderTypeValue = ClubOrderTypeValue,
  >(params: {
    user: AuthenticatedUser;
    orderType: TOrderType;
    storeId: number;
    storeName: string;
    customerId: number | null;
    title: string;
    amountFen: number;
    metadata: TMetadata;
    /**
     * 外部预生成的订单号（与 JSAPI out_trade_no 保持一致）；
     * 不传时内部自动生成。
     */
    orderNo?: string;
    /**
     * 真实 JSAPI 下单返回的支付参数；
     * 不传时 createDraftPayload 会生成开发态 mock 参数。
     */
    paymentParams?: ClubWechatPaymentParamsDto;
  }): Promise<ClubOrderDraftPayload<TMetadata, TOrderType>> {
    const draft = createDraftPayload({
      ...params,
      now: Date.now(),
    });

    await this.persistDraftIfAbsent(draft);
    return draft;
  }

  async getDraft<
    TMetadata extends object = Record<string, unknown>,
    TOrderType extends ClubOrderTypeValue = ClubOrderTypeValue,
  >(
    user: AuthenticatedUser,
    orderId: string,
    expectedType: TOrderType,
  ): Promise<ClubOrderDraftPayload<TMetadata, TOrderType>> {
    const draft = await this.getDraftByOrderId<TMetadata, TOrderType>(
      orderId,
      expectedType,
    );

    if (draft.userId !== user.id) {
      throw new NotFoundException('订单不存在');
    }

    return draft;
  }

  async getDraftByOrderId<
    TMetadata extends object = Record<string, unknown>,
    TOrderType extends ClubOrderTypeValue = ClubOrderTypeValue,
  >(
    orderId: string,
    expectedType: TOrderType,
  ): Promise<ClubOrderDraftPayload<TMetadata, TOrderType>> {
    const draft = await this.redisService.getJson<
      ClubOrderDraftPayload<TMetadata, TOrderType>
    >(buildDraftKey(orderId));

    if (!draft || draft.orderType !== expectedType) {
      throw new NotFoundException('订单不存在');
    }

    const normalizedDraft = normalizeDraft(draft);
    if (normalizedDraft.status !== draft.status) {
      await this.persistDraft(normalizedDraft);
    }

    return normalizedDraft;
  }

  async markPaid<
    TMetadata extends object,
    TOrderType extends ClubOrderTypeValue,
  >(
    draft: ClubOrderDraftPayload<TMetadata, TOrderType>,
    options?: ClubOrderPaidObservationOptions,
  ): Promise<ClubOrderDraftPayload<TMetadata, TOrderType>> {
    const paidDraft = buildPaidDraft(draft, options);

    if (isSamePaidObservation(draft, paidDraft)) {
      return draft;
    }

    await this.persistDraft(paidDraft);
    return paidDraft;
  }

  /**
   * 删除指定订单草稿（用于外部调用失败时回滚清理）
   */
  async deleteDraft(orderId: string): Promise<void> {
    await this.redisService.del(buildDraftKey(orderId));
  }

  /**
   * 更新草稿的支付参数并持久化（用于先创建草稿、再调用微信下单后回写支付参数）
   */
  async updateDraftPaymentParams<
    TMetadata extends object,
    TOrderType extends ClubOrderTypeValue,
  >(
    draft: ClubOrderDraftPayload<TMetadata, TOrderType>,
    paymentParams: import('./dto/club-order.dto').ClubWechatPaymentParamsDto,
  ): Promise<ClubOrderDraftPayload<TMetadata, TOrderType>> {
    const updated = { ...draft, paymentParams };
    await this.persistDraft(updated);
    return updated;
  }

  toOrderStatusResponse<
    TMetadata extends object,
    TOrderType extends ClubOrderTypeValue,
  >(
    draft: ClubOrderDraftPayload<TMetadata, TOrderType>,
  ): ClubOrderStatusResponseDto {
    return toOrderStatusResponse(draft);
  }

  toServiceOrderResponse(
    draft: ClubOrderDraftPayload<ClubServiceOrderMetadata, 'service'>,
  ): ClubServiceOrderResponseDto {
    return toServiceOrderResponse(draft);
  }

  private async persistDraft<
    TMetadata extends object,
    TOrderType extends ClubOrderTypeValue,
  >(draft: ClubOrderDraftPayload<TMetadata, TOrderType>): Promise<void> {
    await this.redisService.setJson(
      buildDraftKey(draft.id),
      draft,
      CLUB_ORDER_DRAFT_TTL_SECONDS,
    );
  }

  /**
   * 仅当 key 不存在时写入草稿（SET NX），防止重复提交创建同一订单
   * 若 key 已存在（重复提交），抛出 ConflictException
   */
  private async persistDraftIfAbsent<
    TMetadata extends object,
    TOrderType extends ClubOrderTypeValue,
  >(draft: ClubOrderDraftPayload<TMetadata, TOrderType>): Promise<void> {
    const created = await this.redisService.setIfAbsent(
      buildDraftKey(draft.id),
      JSON.stringify(draft),
      CLUB_ORDER_DRAFT_TTL_SECONDS,
    );
    if (!created) {
      throw new ConflictException('订单已存在，请勿重复提交');
    }
  }
}
