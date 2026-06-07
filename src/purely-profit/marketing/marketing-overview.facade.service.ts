import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import type { MarketingOverviewDto } from './dto/marketing-response.dto';
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
}
