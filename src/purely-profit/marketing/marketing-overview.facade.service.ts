import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import type {
  UpdateMarketingMemberLevelDto,
  UpdateMarketingPointsRatioDto,
} from './dto/marketing-query.dto';
import type {
  MarketingMemberLevelDto,
  MarketingMemberLevelSettingsDto,
  MarketingOverviewDto,
  MarketingPointsRatioDto,
} from './dto/marketing-response.dto';
import { MarketingOverviewService } from './marketing-overview.service';

@Injectable()
export class MarketingOverviewFacadeService {
  constructor(
    private readonly marketingOverviewService: MarketingOverviewService,
  ) {}

  getOverview(
    user: AuthenticatedUser,
    storeId?: number,
  ): Promise<MarketingOverviewDto> {
    return this.marketingOverviewService.getOverview(user, storeId);
  }

  getMemberLevelSettings(
    user: AuthenticatedUser,
    storeId?: number,
  ): Promise<MarketingMemberLevelSettingsDto> {
    return this.marketingOverviewService.getMemberLevelSettings(user, storeId);
  }

  updateMemberLevel(
    user: AuthenticatedUser,
    levelId: string,
    dto: UpdateMarketingMemberLevelDto,
    storeId?: number,
  ): Promise<MarketingMemberLevelDto> {
    return this.marketingOverviewService.updateMemberLevel(
      user,
      levelId,
      dto,
      storeId,
    );
  }

  updatePointsRatio(
    user: AuthenticatedUser,
    dto: UpdateMarketingPointsRatioDto,
    storeId?: number,
  ): Promise<MarketingPointsRatioDto> {
    return this.marketingOverviewService.updatePointsRatio(user, dto, storeId);
  }
}
