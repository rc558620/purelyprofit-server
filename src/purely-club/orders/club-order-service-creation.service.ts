import { Injectable } from '@nestjs/common';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { ClubOrderDraftsService } from './club-order-drafts.service';
import { ClubOrderPromotionsService } from './club-order-promotions.service';
import { ClubOrderServiceContextService } from './club-order-service-context.service';
import type { ClubServiceOrderResponseDto } from './dto/club-order.dto';
import type { CreateClubServiceOrderDto } from './dto/club-order.dto';

@Injectable()
export class ClubOrderServiceCreationService {
  constructor(
    private readonly clubOrderDraftsService: ClubOrderDraftsService,
    private readonly clubOrderPromotionsService: ClubOrderPromotionsService,
    private readonly clubOrderServiceContextService: ClubOrderServiceContextService,
  ) {}

  async createServiceOrder(
    currentContext: ClubCurrentContext,
    dto: CreateClubServiceOrderDto,
  ): Promise<ClubServiceOrderResponseDto> {
    const context =
      await this.clubOrderServiceContextService.resolveCreateServiceOrderContext(
        currentContext,
        dto,
      );
    const eligiblePromotion =
      await this.clubOrderPromotionsService.resolveEligibleFirstOrderPromotion(
        context.store.id,
        context.customer.id,
        context.product.price,
      );
    const draft = await this.clubOrderDraftsService.createDraft({
      user: currentContext.user,
      orderType: 'service',
      storeId: context.store.id,
      storeName: context.store.name,
      customerId: context.customer.id,
      title: `购买${context.product.name}`,
      amountFen: eligiblePromotion?.amountFen ?? context.product.price,
      metadata: this.clubOrderServiceContextService.buildDraftMetadata(
        context.product,
        eligiblePromotion,
      ),
    });

    return this.clubOrderDraftsService.toServiceOrderResponse(draft);
  }
}
