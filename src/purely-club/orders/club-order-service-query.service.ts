import { Injectable } from '@nestjs/common';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { ClubOrderDraftsService } from './club-order-drafts.service';
import type { ClubOrderDraftPayload } from './club-order-drafts.types';
import type { ClubServiceOrderMetadata } from './club-order-drafts.types';
import type { ClubOrderStatusResponseDto } from './dto/club-order.dto';

@Injectable()
export class ClubOrderServiceQueryService {
  constructor(
    private readonly clubOrderDraftsService: ClubOrderDraftsService,
  ) {}

  async getOrderStatus(
    currentContext: ClubCurrentContext,
    orderId: string,
  ): Promise<ClubOrderStatusResponseDto> {
    const draft = await this.getServiceDraft(currentContext, orderId);
    return this.clubOrderDraftsService.toOrderStatusResponse(draft);
  }

  getServiceDraft(
    currentContext: ClubCurrentContext,
    orderId: string,
  ): Promise<ClubOrderDraftPayload<ClubServiceOrderMetadata, 'service'>> {
    return this.clubOrderDraftsService.getDraft(
      currentContext.user,
      orderId,
      'service',
    );
  }

  getServiceDraftByOrderId(
    orderId: string,
  ): Promise<ClubOrderDraftPayload<ClubServiceOrderMetadata, 'service'>> {
    return this.clubOrderDraftsService.getDraftByOrderId(orderId, 'service');
  }
}
