import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import type {
  CreateConsumptionDto,
  CreateRechargeDto,
  ListPointsRecordsQueryDto,
  ListRechargesQueryDto,
} from './dto/marketing-query.dto';
import type {
  MarketingConsumptionDto,
  MarketingPointsRecordsResponseDto,
  MarketingRechargeDto,
  MarketingRechargesResponseDto,
} from './dto/marketing-response.dto';
import { MarketingConsumptionsService } from './marketing-consumptions.service';
import { MarketingPointsRecordsService } from './marketing-points-records.service';
import { MarketingRechargesService } from './marketing-recharges.service';

@Injectable()
export class MarketingTransactionsFacadeService {
  constructor(
    private readonly marketingRechargesService: MarketingRechargesService,
    private readonly marketingPointsRecordsService: MarketingPointsRecordsService,
    private readonly marketingConsumptionsService: MarketingConsumptionsService,
  ) {}

  listRecharges(
    user: AuthenticatedUser,
    query: ListRechargesQueryDto & { storeId?: number },
  ): Promise<MarketingRechargesResponseDto> {
    return this.marketingRechargesService.listRecharges(user, query);
  }

  createRecharge(
    user: AuthenticatedUser,
    storeId: number,
    dto: CreateRechargeDto,
  ): Promise<MarketingRechargeDto> {
    return this.marketingRechargesService.createRecharge(user, storeId, dto);
  }

  listPointsRecords(
    user: AuthenticatedUser,
    query: ListPointsRecordsQueryDto & { storeId?: number },
  ): Promise<MarketingPointsRecordsResponseDto> {
    return this.marketingPointsRecordsService.listPointsRecords(user, query);
  }

  createConsumption(
    user: AuthenticatedUser,
    storeId: number,
    dto: CreateConsumptionDto,
  ): Promise<MarketingConsumptionDto> {
    return this.marketingConsumptionsService.createConsumption(
      user,
      storeId,
      dto,
    );
  }
}
