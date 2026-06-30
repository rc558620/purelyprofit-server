import { Injectable } from '@nestjs/common';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { ClubOrderPreviewService } from './club-order-preview.service';
import { ClubOrderServiceCreationService } from './club-order-service-creation.service';
import { ClubOrderServicePaymentService } from './club-order-service-payment.service';
import { ClubOrderServiceQueryService } from './club-order-service-query.service';
import type {
  ClubOrderStatusResponseDto,
  ClubServiceOrderPreviewResponseDto,
  ClubServiceOrderResponseDto,
  CreateClubServiceOrderDto,
  PreviewClubServiceOrderDto,
} from './dto/club-order.dto';

@Injectable()
export class ClubOrdersService {
  constructor(
    private readonly clubOrderPreviewService: ClubOrderPreviewService,
    private readonly clubOrderServiceCreationService: ClubOrderServiceCreationService,
    private readonly clubOrderServiceQueryService: ClubOrderServiceQueryService,
    private readonly clubOrderServicePaymentService: ClubOrderServicePaymentService,
  ) {}

  previewServiceOrder(
    currentContext: ClubCurrentContext,
    dto: PreviewClubServiceOrderDto,
  ): Promise<ClubServiceOrderPreviewResponseDto> {
    return this.clubOrderPreviewService.previewServiceOrder(
      currentContext,
      dto,
    );
  }

  createServiceOrder(
    currentContext: ClubCurrentContext,
    dto: CreateClubServiceOrderDto,
  ): Promise<ClubServiceOrderResponseDto> {
    return this.clubOrderServiceCreationService.createServiceOrder(
      currentContext,
      dto,
    );
  }

  getOrderStatus(
    currentContext: ClubCurrentContext,
    orderId: string,
  ): Promise<ClubOrderStatusResponseDto> {
    return this.clubOrderServiceQueryService.getOrderStatus(
      currentContext,
      orderId,
    );
  }

  confirmOrderPaid(
    currentContext: ClubCurrentContext,
    orderId: string,
  ): Promise<ClubServiceOrderResponseDto> {
    return this.clubOrderServicePaymentService.confirmOrderPaid(
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
  ): Promise<ClubServiceOrderResponseDto> {
    return this.clubOrderServicePaymentService.confirmOrderPaidByCallback(
      orderId,
      params,
    );
  }
}
