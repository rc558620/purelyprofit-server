import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { RedisService } from '../../redis/redis.service';
import type {
  ClubOrderStatusResponseDto,
  ClubServiceOrderResponseDto,
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
  }): Promise<ClubOrderDraftPayload<TMetadata, TOrderType>> {
    const draft = createDraftPayload({
      ...params,
      now: Date.now(),
    });

    await this.persistDraft(draft);
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
}
