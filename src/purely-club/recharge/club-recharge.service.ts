import { Injectable } from '@nestjs/common';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import type { ClubOrderStatusResponseDto } from '../orders/dto/club-order.dto';
import type {
  ClubRechargeOrderResponseDto,
  ClubRechargePackagesResponseDto,
  CreateClubRechargeOrderDto,
  ListClubRechargePackagesQueryDto,
} from './dto/club-recharge.dto';
import { ClubRechargeCreationService } from './club-recharge-creation.service';
import { ClubRechargePaymentService } from './club-recharge-payment.service';
import { ClubRechargeQueryService } from './club-recharge-query.service';

@Injectable()
export class ClubRechargeService {
  constructor(
    private readonly clubRechargeCreationService: ClubRechargeCreationService,
    private readonly clubRechargeQueryService: ClubRechargeQueryService,
    private readonly clubRechargePaymentService: ClubRechargePaymentService,
  ) {}

  listPackages(
    currentContext: ClubCurrentContext,
    query: ListClubRechargePackagesQueryDto,
  ): Promise<ClubRechargePackagesResponseDto> {
    return this.clubRechargeQueryService.listPackages(currentContext, query);
  }

  createOrder(
    currentContext: ClubCurrentContext,
    dto: CreateClubRechargeOrderDto,
  ): Promise<ClubRechargeOrderResponseDto> {
    return this.clubRechargeCreationService.createOrder(currentContext, dto);
  }

  getOrderStatus(
    currentContext: ClubCurrentContext,
    orderId: string,
  ): Promise<ClubOrderStatusResponseDto> {
    return this.clubRechargeQueryService.getOrderStatus(
      currentContext,
      orderId,
    );
  }

  confirmOrderPaid(
    currentContext: ClubCurrentContext,
    orderId: string,
  ): Promise<ClubRechargeOrderResponseDto> {
    return this.clubRechargePaymentService.confirmOrderPaid(
      currentContext,
      orderId,
    );
  }

  confirmOrderPaidByCallback(
    orderId: string,
    params: {
      amountFen: number;
      transactionId: string;
      paidAtMs: number;
      callbackReceivedAtMs: number;
    },
  ): Promise<ClubRechargeOrderResponseDto> {
    return this.clubRechargePaymentService.confirmOrderPaidByCallback(
      orderId,
      params,
    );
  }
}
