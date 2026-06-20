import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import type {
  CreateCustomerDto,
  ListCustomerPointsRecordsQueryDto,
  ListCustomerRechargesQueryDto,
  ListCustomersQueryDto,
  UpdateCustomerDto,
} from './dto/marketing-query.dto';
import type {
  MarketingConsumptionsResponseDto,
  MarketingCustomerDetailDto,
  MarketingCustomerDto,
  MarketingCustomersResponseDto,
  MarketingPointsRecordsResponseDto,
  MarketingRechargesResponseDto,
} from './dto/marketing-response.dto';
import { MarketingConsumptionsService } from './marketing-consumptions.service';
import { MarketingCustomersService } from './marketing-customers.service';
import { MarketingPointsRecordsService } from './marketing-points-records.service';
import { MarketingRechargesService } from './marketing-recharges.service';

@Injectable()
export class MarketingCustomersFacadeService {
  constructor(
    private readonly marketingCustomersService: MarketingCustomersService,
    private readonly marketingRechargesService: MarketingRechargesService,
    private readonly marketingPointsRecordsService: MarketingPointsRecordsService,
    private readonly marketingConsumptionsService: MarketingConsumptionsService,
  ) {}

  listCustomers(
    user: AuthenticatedUser,
    query: ListCustomersQueryDto,
  ): Promise<MarketingCustomersResponseDto> {
    return this.marketingCustomersService.listCustomers(user, query);
  }

  getCustomer(
    user: AuthenticatedUser,
    customerId: number,
  ): Promise<MarketingCustomerDetailDto> {
    return this.marketingCustomersService.getCustomer(user, customerId);
  }

  createCustomer(
    user: AuthenticatedUser,
    storeId: number,
    dto: CreateCustomerDto,
  ): Promise<MarketingCustomerDto> {
    return this.marketingCustomersService.createCustomer(user, storeId, dto);
  }

  updateCustomer(
    user: AuthenticatedUser,
    customerId: number,
    dto: UpdateCustomerDto,
  ): Promise<MarketingCustomerDto> {
    return this.marketingCustomersService.updateCustomer(user, customerId, dto);
  }

  deleteCustomer(user: AuthenticatedUser, customerId: number): Promise<void> {
    return this.marketingCustomersService.deleteCustomer(user, customerId);
  }

  listCustomerRecharges(
    user: AuthenticatedUser,
    customerId: number,
    query: ListCustomerRechargesQueryDto,
  ): Promise<MarketingRechargesResponseDto> {
    return this.marketingRechargesService.listCustomerRecharges(
      user,
      customerId,
      query,
    );
  }

  listCustomerPointsRecords(
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

  listConsumptions(
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
}
