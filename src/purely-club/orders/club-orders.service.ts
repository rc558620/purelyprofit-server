import { Injectable } from '@nestjs/common';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { ClubOrderPreviewService } from './club-order-preview.service';
import { ClubOrderServiceCreationService } from './club-order-service-creation.service';
import { ClubOrderServicePaymentService } from './club-order-service-payment.service';
import { ClubOrderServiceQueryService } from './club-order-service-query.service';
import { ClubOrderWechatVerifyService } from './club-order-wechat-verify.service';
import type {
  ClubOrderStatusQueryDto,
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
    private readonly clubOrderWechatVerifyService: ClubOrderWechatVerifyService,
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
    idempotencyKey?: string,
  ): Promise<ClubServiceOrderResponseDto> {
    return this.clubOrderServiceCreationService.createServiceOrder(
      currentContext,
      dto,
      idempotencyKey,
    );
  }

  /**
   * 查询服务订单状态。
   *
   * verify=true 时先回微信侧核对并补落账，再读本地状态：
   * 前端在拉起支付后结果未知（unknown）时用这个入口确认用户是否已扣款。
   */
  async getOrderStatus(
    currentContext: ClubCurrentContext,
    orderId: string,
    query?: ClubOrderStatusQueryDto,
  ): Promise<ClubOrderStatusResponseDto> {
    if (query?.verify === true) {
      await this.clubOrderWechatVerifyService.verifyAndSettle(
        currentContext,
        orderId,
      );
    }

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
