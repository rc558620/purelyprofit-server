import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import type {
  CreateConsumptionDto,
  CreateCustomerDto,
  CreatePromotionDto,
  CreateRechargeDto,
  ListCustomerPointsRecordsQueryDto,
  ListCustomersQueryDto,
  ListPointsRecordsQueryDto,
  ListPromotionsQueryDto,
  ListRechargesQueryDto,
  UpdateCustomerDto,
  UpdatePromotionDto,
} from './dto/marketing-query.dto';
import type {
  MarketingConsumptionDto,
  MarketingConsumptionsResponseDto,
  MarketingCustomerDetailDto,
  MarketingCustomerDto,
  MarketingCustomersResponseDto,
  MarketingOverviewDto,
  MarketingPointsRecordsResponseDto,
  MarketingPromotionDto,
  MarketingPromotionsResponseDto,
  MarketingRechargeDto,
  MarketingRechargesResponseDto,
} from './dto/marketing-response.dto';
import { MarketingConsumptionsService } from './marketing-consumptions.service';
import { MarketingCustomersService } from './marketing-customers.service';
import { MarketingOverviewService } from './marketing-overview.service';
import { MarketingPointsRecordsService } from './marketing-points-records.service';
import { MarketingPromotionsService } from './marketing-promotions.service';
import { MarketingRechargesService } from './marketing-recharges.service';

@Injectable()
export class MarketingService {
  constructor(
    private readonly marketingOverviewService: MarketingOverviewService,
    private readonly marketingCustomersService: MarketingCustomersService,
    private readonly marketingRechargesService: MarketingRechargesService,
    private readonly marketingPointsRecordsService: MarketingPointsRecordsService,
    private readonly marketingConsumptionsService: MarketingConsumptionsService,
    private readonly marketingPromotionsService: MarketingPromotionsService,
  ) {}

  async getOverview(
    user: AuthenticatedUser,
    storeId?: number,
  ): Promise<MarketingOverviewDto> {
    return this.marketingOverviewService.getOverview(user, storeId);
  }

  async listCustomers(
    user: AuthenticatedUser,
    query: ListCustomersQueryDto & { storeId?: number },
  ): Promise<MarketingCustomersResponseDto> {
    return this.marketingCustomersService.listCustomers(user, query);
  }

  async getCustomer(
    user: AuthenticatedUser,
    customerId: number,
  ): Promise<MarketingCustomerDetailDto> {
    return this.marketingCustomersService.getCustomer(user, customerId);
  }

  async createCustomer(
    user: AuthenticatedUser,
    storeId: number,
    dto: CreateCustomerDto,
  ): Promise<MarketingCustomerDto> {
    return this.marketingCustomersService.createCustomer(user, storeId, dto);
  }

  async updateCustomer(
    user: AuthenticatedUser,
    customerId: number,
    dto: UpdateCustomerDto,
  ): Promise<MarketingCustomerDto> {
    return this.marketingCustomersService.updateCustomer(user, customerId, dto);
  }

  async deleteCustomer(
    user: AuthenticatedUser,
    customerId: number,
  ): Promise<void> {
    return this.marketingCustomersService.deleteCustomer(user, customerId);
  }

  async listRecharges(
    user: AuthenticatedUser,
    query: ListRechargesQueryDto & { storeId?: number },
  ): Promise<MarketingRechargesResponseDto> {
    return this.marketingRechargesService.listRecharges(user, query);
  }

  async listCustomerRecharges(
    user: AuthenticatedUser,
    customerId: number,
    query: { page?: number; pageSize?: number },
  ): Promise<MarketingRechargesResponseDto> {
    return this.marketingRechargesService.listCustomerRecharges(
      user,
      customerId,
      query,
    );
  }

  async createRecharge(
    user: AuthenticatedUser,
    storeId: number,
    dto: CreateRechargeDto,
  ): Promise<MarketingRechargeDto> {
    return this.marketingRechargesService.createRecharge(user, storeId, dto);
  }

  async listPointsRecords(
    user: AuthenticatedUser,
    query: ListPointsRecordsQueryDto & { storeId?: number },
  ): Promise<MarketingPointsRecordsResponseDto> {
    return this.marketingPointsRecordsService.listPointsRecords(user, query);
  }

  async listCustomerPointsRecords(
    user: AuthenticatedUser,
    customerId: number,
    query: ListCustomerPointsRecordsQueryDto,
  ): Promise<MarketingPointsRecordsResponseDto> {
    return this.marketingPointsRecordsService.listCustomerPointsRecords(
      user,
      customerId,
      query,
    );
  }

  async listConsumptions(
    user: AuthenticatedUser,
    customerId: number,
    query: { page?: number; pageSize?: number; storeId?: number },
  ): Promise<MarketingConsumptionsResponseDto> {
    return this.marketingConsumptionsService.listConsumptions(
      user,
      customerId,
      query,
    );
  }

  async createConsumption(
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

  async listPromotions(
    user: AuthenticatedUser,
    query: ListPromotionsQueryDto & { storeId?: number },
  ): Promise<MarketingPromotionsResponseDto> {
    return this.marketingPromotionsService.listPromotions(user, query);
  }

  async getPromotion(
    user: AuthenticatedUser,
    promotionId: number,
  ): Promise<MarketingPromotionDto> {
    return this.marketingPromotionsService.getPromotion(user, promotionId);
  }

  async createPromotion(
    user: AuthenticatedUser,
    storeId: number,
    dto: CreatePromotionDto,
  ): Promise<MarketingPromotionDto> {
    return this.marketingPromotionsService.createPromotion(user, storeId, dto);
  }

  async updatePromotion(
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

  async deletePromotion(
    user: AuthenticatedUser,
    promotionId: number,
  ): Promise<void> {
    return this.marketingPromotionsService.deletePromotion(user, promotionId);
  }

  async togglePromotion(
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
