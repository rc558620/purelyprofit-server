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
  UpdateMarketingMemberLevelDto,
  UpdateMarketingPointsRatioDto,
  UpdatePromotionDto,
} from './dto/marketing-query.dto';

import type {
  CreateMarketingProductCategoryDto,
  CreateMarketingProductDto,
  ListMarketingProductsQueryDto,
  MarketingProductCategoriesResponseDto,
  MarketingProductCategoryDto,
  MarketingProductDto,
  MarketingProductsResponseDto,
  ToggleMarketingProductDto,
  UpdateMarketingProductCategoryDto,
  UpdateMarketingProductDto,
} from './dto/marketing-product.dto';
import type {
  MarketingConsumptionDto,
  MarketingConsumptionsResponseDto,
  MarketingCustomerDetailDto,
  MarketingCustomerDto,
  MarketingCustomersResponseDto,
  MarketingMemberLevelDto,
  MarketingMemberLevelSettingsDto,
  MarketingOverviewDto,
  MarketingPointsRatioDto,
  MarketingPointsRecordsResponseDto,
  MarketingPromotionDto,
  MarketingPromotionsResponseDto,
  MarketingRechargeDto,
  MarketingRechargesResponseDto,
} from './dto/marketing-response.dto';

import { MarketingCustomersFacadeService } from './marketing-customers.facade.service';
import { MarketingOverviewFacadeService } from './marketing-overview.facade.service';
import { MarketingProductsFacadeService } from './marketing-products.facade.service';
import { MarketingPromotionsFacadeService } from './marketing-promotions.facade.service';
import { MarketingTransactionsFacadeService } from './marketing-transactions.facade.service';

@Injectable()
export class MarketingFacadeService {
  constructor(
    private readonly marketingOverviewFacadeService: MarketingOverviewFacadeService,
    private readonly marketingCustomersFacadeService: MarketingCustomersFacadeService,
    private readonly marketingTransactionsFacadeService: MarketingTransactionsFacadeService,
    private readonly marketingPromotionsFacadeService: MarketingPromotionsFacadeService,
    private readonly marketingProductsFacadeService: MarketingProductsFacadeService,
  ) {}

  getOverview(
    user: AuthenticatedUser,
    storeId?: number,
  ): Promise<MarketingOverviewDto> {
    return this.marketingOverviewFacadeService.getOverview(user, storeId);
  }

  getMemberLevelSettings(
    user: AuthenticatedUser,
    storeId?: number,
  ): Promise<MarketingMemberLevelSettingsDto> {
    return this.marketingOverviewFacadeService.getMemberLevelSettings(
      user,
      storeId,
    );
  }

  updateMemberLevel(
    user: AuthenticatedUser,
    levelId: string,
    dto: UpdateMarketingMemberLevelDto,
    storeId?: number,
  ): Promise<MarketingMemberLevelDto> {
    return this.marketingOverviewFacadeService.updateMemberLevel(
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
    return this.marketingOverviewFacadeService.updatePointsRatio(
      user,
      dto,
      storeId,
    );
  }

  listCustomers(
    user: AuthenticatedUser,
    query: ListCustomersQueryDto,
  ): Promise<MarketingCustomersResponseDto> {
    return this.marketingCustomersFacadeService.listCustomers(user, query);
  }

  getCustomer(
    user: AuthenticatedUser,
    customerId: number,
  ): Promise<MarketingCustomerDetailDto> {
    return this.marketingCustomersFacadeService.getCustomer(user, customerId);
  }

  createCustomer(
    user: AuthenticatedUser,
    storeId: number,
    dto: CreateCustomerDto,
  ): Promise<MarketingCustomerDto> {
    return this.marketingCustomersFacadeService.createCustomer(
      user,
      storeId,
      dto,
    );
  }

  updateCustomer(
    user: AuthenticatedUser,
    customerId: number,
    dto: UpdateCustomerDto,
  ): Promise<MarketingCustomerDto> {
    return this.marketingCustomersFacadeService.updateCustomer(
      user,
      customerId,
      dto,
    );
  }

  deleteCustomer(user: AuthenticatedUser, customerId: number): Promise<void> {
    return this.marketingCustomersFacadeService.deleteCustomer(
      user,
      customerId,
    );
  }

  listRecharges(
    user: AuthenticatedUser,
    query: ListRechargesQueryDto,
  ): Promise<MarketingRechargesResponseDto> {
    return this.marketingTransactionsFacadeService.listRecharges(user, query);
  }

  listCustomerRecharges(
    user: AuthenticatedUser,
    customerId: number,
    query: { page?: number; pageSize?: number },
  ): Promise<MarketingRechargesResponseDto> {
    return this.marketingCustomersFacadeService.listCustomerRecharges(
      user,
      customerId,
      query,
    );
  }

  createRecharge(
    user: AuthenticatedUser,
    storeId: number,
    dto: CreateRechargeDto,
  ): Promise<MarketingRechargeDto> {
    return this.marketingTransactionsFacadeService.createRecharge(
      user,
      storeId,
      dto,
    );
  }

  listPointsRecords(
    user: AuthenticatedUser,
    query: ListPointsRecordsQueryDto,
  ): Promise<MarketingPointsRecordsResponseDto> {
    return this.marketingTransactionsFacadeService.listPointsRecords(
      user,
      query,
    );
  }

  listCustomerPointsRecords(
    user: AuthenticatedUser,
    customerId: number,
    query: ListCustomerPointsRecordsQueryDto,
  ): Promise<MarketingPointsRecordsResponseDto> {
    return this.marketingCustomersFacadeService.listCustomerPointsRecords(
      user,
      customerId,
      query,
    );
  }

  listConsumptions(
    user: AuthenticatedUser,
    customerId: number,
    query: { page?: number; pageSize?: number; storeId?: number },
  ): Promise<MarketingConsumptionsResponseDto> {
    return this.marketingCustomersFacadeService.listConsumptions(
      user,
      customerId,
      query,
    );
  }

  createConsumption(
    user: AuthenticatedUser,
    storeId: number,
    dto: CreateConsumptionDto,
  ): Promise<MarketingConsumptionDto> {
    return this.marketingTransactionsFacadeService.createConsumption(
      user,
      storeId,
      dto,
    );
  }

  listPromotions(
    user: AuthenticatedUser,
    query: ListPromotionsQueryDto,
  ): Promise<MarketingPromotionsResponseDto> {
    return this.marketingPromotionsFacadeService.listPromotions(user, query);
  }

  getPromotion(
    user: AuthenticatedUser,
    promotionId: number,
  ): Promise<MarketingPromotionDto> {
    return this.marketingPromotionsFacadeService.getPromotion(
      user,
      promotionId,
    );
  }

  createPromotion(
    user: AuthenticatedUser,
    storeId: number,
    dto: CreatePromotionDto,
  ): Promise<MarketingPromotionDto> {
    return this.marketingPromotionsFacadeService.createPromotion(
      user,
      storeId,
      dto,
    );
  }

  updatePromotion(
    user: AuthenticatedUser,
    promotionId: number,
    dto: UpdatePromotionDto,
  ): Promise<MarketingPromotionDto> {
    return this.marketingPromotionsFacadeService.updatePromotion(
      user,
      promotionId,
      dto,
    );
  }

  deletePromotion(user: AuthenticatedUser, promotionId: number): Promise<void> {
    return this.marketingPromotionsFacadeService.deletePromotion(
      user,
      promotionId,
    );
  }

  togglePromotion(
    user: AuthenticatedUser,
    promotionId: number,
    enabled: boolean,
  ): Promise<MarketingPromotionDto> {
    return this.marketingPromotionsFacadeService.togglePromotion(
      user,
      promotionId,
      enabled,
    );
  }

  listProductCategories(
    user: AuthenticatedUser,
    storeId?: number,
  ): Promise<MarketingProductCategoriesResponseDto> {
    return this.marketingProductsFacadeService.listProductCategories(
      user,
      storeId,
    );
  }

  createProductCategory(
    user: AuthenticatedUser,
    storeId: number,
    dto: CreateMarketingProductCategoryDto,
  ): Promise<MarketingProductCategoryDto> {
    return this.marketingProductsFacadeService.createProductCategory(
      user,
      storeId,
      dto,
    );
  }

  updateProductCategory(
    user: AuthenticatedUser,
    categoryId: number,
    dto: UpdateMarketingProductCategoryDto,
  ): Promise<MarketingProductCategoryDto> {
    return this.marketingProductsFacadeService.updateProductCategory(
      user,
      categoryId,
      dto,
    );
  }

  deleteProductCategory(
    user: AuthenticatedUser,
    categoryId: number,
  ): Promise<void> {
    return this.marketingProductsFacadeService.deleteProductCategory(
      user,
      categoryId,
    );
  }

  listProducts(
    user: AuthenticatedUser,
    query: ListMarketingProductsQueryDto,
  ): Promise<MarketingProductsResponseDto> {
    return this.marketingProductsFacadeService.listProducts(user, query);
  }

  createProduct(
    user: AuthenticatedUser,
    storeId: number,
    dto: CreateMarketingProductDto,
  ): Promise<MarketingProductDto> {
    return this.marketingProductsFacadeService.createProduct(
      user,
      storeId,
      dto,
    );
  }

  updateProduct(
    user: AuthenticatedUser,
    productId: number,
    dto: UpdateMarketingProductDto,
  ): Promise<MarketingProductDto> {
    return this.marketingProductsFacadeService.updateProduct(
      user,
      productId,
      dto,
    );
  }

  toggleProduct(
    user: AuthenticatedUser,
    productId: number,
    dto: ToggleMarketingProductDto,
  ): Promise<MarketingProductDto> {
    return this.marketingProductsFacadeService.toggleProduct(
      user,
      productId,
      dto,
    );
  }

  deleteProduct(user: AuthenticatedUser, productId: number): Promise<void> {
    return this.marketingProductsFacadeService.deleteProduct(user, productId);
  }
}
