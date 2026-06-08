import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import type {
  CreatePromotionDto,
  ListPromotionsQueryDto,
  UpdatePromotionDto,
} from './dto/marketing-query.dto';
import type {
  MarketingPromotionDto,
  MarketingPromotionsResponseDto,
} from './dto/marketing-response.dto';
import { MarketingPromotionsService } from './marketing-promotions.service';

@Injectable()
export class MarketingPromotionsFacadeService {
  constructor(
    private readonly marketingPromotionsService: MarketingPromotionsService,
  ) {}

  listPromotions(
    user: AuthenticatedUser,
    query: ListPromotionsQueryDto & { storeId?: number },
  ): Promise<MarketingPromotionsResponseDto> {
    return this.marketingPromotionsService.listPromotions(user, query);
  }

  getPromotion(
    user: AuthenticatedUser,
    promotionId: number,
  ): Promise<MarketingPromotionDto> {
    return this.marketingPromotionsService.getPromotion(user, promotionId);
  }

  createPromotion(
    user: AuthenticatedUser,
    storeId: number,
    dto: CreatePromotionDto,
  ): Promise<MarketingPromotionDto> {
    return this.marketingPromotionsService.createPromotion(user, storeId, dto);
  }

  updatePromotion(
    user: AuthenticatedUser,
    promotionId: number,
    dto: UpdatePromotionDto,
  ): Promise<MarketingPromotionDto> {
    return this.marketingPromotionsService.updatePromotion(
      user,
      promotionId,
      dto,
    );
  }

  deletePromotion(user: AuthenticatedUser, promotionId: number): Promise<void> {
    return this.marketingPromotionsService.deletePromotion(user, promotionId);
  }

  togglePromotion(
    user: AuthenticatedUser,
    promotionId: number,
    enabled: boolean,
  ): Promise<MarketingPromotionDto> {
    return this.marketingPromotionsService.togglePromotion(
      user,
      promotionId,
      enabled,
    );
  }
}
