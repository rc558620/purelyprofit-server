import { Injectable } from '@nestjs/common';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { ClubOrderDraftsService } from '../orders/club-order-drafts.service';
import type {
  ClubOrderDraftPayload,
  ClubRechargeOrderMetadata,
} from '../orders/club-order-drafts.types';
import type { ClubOrderStatusResponseDto } from '../orders/dto/club-order.dto';
import type {
  ClubRechargeOrderResponseDto,
  ClubRechargePackagesResponseDto,
  ListClubRechargePackagesQueryDto,
} from './dto/club-recharge.dto';
import { toClubRechargeOrderResponse } from './club-recharge.mapper';
import { ClubRechargePackagesService } from './club-recharge-packages.service';
import { CLUB_RECHARGE_PREVIEW_COUNT } from './club-recharge.constants';

@Injectable()
export class ClubRechargeQueryService {
  constructor(
    private readonly clubRechargePackagesService: ClubRechargePackagesService,
    private readonly clubOrderDraftsService: ClubOrderDraftsService,
  ) {}

  async listPackages(
    currentContext: ClubCurrentContext,
    query: ListClubRechargePackagesQueryDto,
  ): Promise<ClubRechargePackagesResponseDto> {
    const packages = await this.clubRechargePackagesService.loadPackagesForStore(
      currentContext.store.id,
    );

    return {
      items: query.preview
        ? packages.slice(0, CLUB_RECHARGE_PREVIEW_COUNT)
        : packages,
    };
  }

  async getOrderStatus(
    currentContext: ClubCurrentContext,
    orderId: string,
  ): Promise<ClubRechargeOrderResponseDto> {
    const draft = await this.getRechargeDraft(currentContext, orderId);
    return this.toRechargeOrderResponse(draft);
  }

  getRechargeDraft(
    currentContext: ClubCurrentContext,
    orderId: string,
  ): Promise<ClubOrderDraftPayload<ClubRechargeOrderMetadata, 'recharge'>> {
    return this.clubOrderDraftsService.getDraft(
      currentContext.user,
      orderId,
      'recharge',
    );
  }

  getRechargeDraftByOrderId(
    orderId: string,
  ): Promise<ClubOrderDraftPayload<ClubRechargeOrderMetadata, 'recharge'>> {
    return this.clubOrderDraftsService.getDraftByOrderId(orderId, 'recharge');
  }

  toRechargeOrderResponse(
    draft: ClubOrderDraftPayload<ClubRechargeOrderMetadata, 'recharge'>,
  ): ClubRechargeOrderResponseDto {
    const base: ClubOrderStatusResponseDto =
      this.clubOrderDraftsService.toOrderStatusResponse(draft);
    return toClubRechargeOrderResponse(base, draft);
  }
}
