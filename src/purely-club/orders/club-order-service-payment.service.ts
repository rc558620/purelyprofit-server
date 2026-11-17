import { ConflictException, Injectable } from '@nestjs/common';
import { CLUB_ORDER_ERROR_CODE, clubOrderError } from './club-orders.errors';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import type {
  ClubOrderDraftPayload,
  ClubServiceOrderMetadata,
} from './club-order-drafts.types';
import type { ClubPaymentCallbackSettlementParams } from '../payments/club-payments.types';
import { ClubPaymentConfirmationOrchestrator } from '../payments/club-payment-confirmation.orchestrator';
import { ClubPaymentModeService } from '../payments/club-payment-mode.service';
import { ClubPrepayAttemptService } from '../payments/club-prepay-attempt.service';
import { ClubOrderSettlementService } from './club-order-settlement.service';
import { ClubOrderServiceQueryService } from './club-order-service-query.service';
import type {
  ClubOrderPaymentParamsResponseDto,
  ClubServiceOrderResponseDto,
} from './dto/club-order.dto';

@Injectable()
export class ClubOrderServicePaymentService {
  private readonly paymentConfirmationOrchestrator: ClubPaymentConfirmationOrchestrator<
    ClubCurrentContext,
    ClubOrderDraftPayload<ClubServiceOrderMetadata, 'service'>,
    ClubServiceOrderResponseDto
  >;

  constructor(
    private readonly clubPaymentModeService: ClubPaymentModeService,
    private readonly clubOrderSettlementService: ClubOrderSettlementService,
    private readonly clubOrderServiceQueryService: ClubOrderServiceQueryService,
    private readonly clubPrepayAttemptService: ClubPrepayAttemptService,
  ) {
    this.paymentConfirmationOrchestrator =
      new ClubPaymentConfirmationOrchestrator({
        isManualConfirmPaidAllowed: () =>
          this.clubPaymentModeService.isManualConfirmPaidAllowed(),
        loadDraftForManualConfirm: (
          currentContext: ClubCurrentContext,
          orderNo: string,
        ) =>
          this.clubOrderServiceQueryService.getServiceDraft(
            currentContext,
            orderNo,
          ),
        loadDraftByOrderNo: (orderNo: string) =>
          this.clubOrderServiceQueryService.getServiceDraftByOrderNo(orderNo),
        resolveDraftAmountFen: (draft) => draft.amountFen,
        completePaidDraft: (draft, paymentMeta) =>
          this.clubOrderSettlementService.completePaidDraft(draft, paymentMeta),
      });
  }

  /**
   * 按需取支付参数（建单 prepay=false 时由前端单独调用）。
   *
   * 与建单解耦后：微信变慢只影响「拉起收银台」这一步，订单已经落好，
   * 失败可原样重试而不会重复建单、不会重复扣新客额度。
   */
  async createServiceOrderPaymentParams(
    currentContext: ClubCurrentContext,
    orderNo: string,
    openid?: string,
  ): Promise<ClubOrderPaymentParamsResponseDto> {
    const draft = await this.clubOrderServiceQueryService.getServiceDraft(
      currentContext,
      orderNo,
    );
    this.assertDraftPayable(draft);

    const result = await this.clubPrepayAttemptService.createPaymentParams({
      baseOrderNo: draft.orderNo,
      storeId: draft.storeId,
      description: `购买${draft.metadata.productName}`,
      amountFen: draft.amountFen,
      userId: currentContext.user.id,
      openid,
      buildError: (reason) =>
        reason === 'in_flight'
          ? new ConflictException(
              clubOrderError(
                CLUB_ORDER_ERROR_CODE.STATUS_PAYMENT_IN_FLIGHT,
                '支付请求正在处理中，请稍后重试',
              ),
            )
          : new ConflictException(
              clubOrderError(
                CLUB_ORDER_ERROR_CODE.STATUS_PAYMENT_ATTEMPT_EXHAUSTED,
                '支付尝试次数过多，请重新下单',
              ),
            ),
    });

    return { orderNo: draft.orderNo, ...result };
  }

  /**
   * 只有「仍待支付且未过期」的草稿才允许取参。
   *
   * 草稿读取时已按 expiresAtMs 归一（超时置 expired），这里再兜一层未来时间，
   * 避免临界秒内把参数发给一个马上失效的订单。
   */
  private assertDraftPayable(
    draft: ClubOrderDraftPayload<ClubServiceOrderMetadata, 'service'>,
  ): void {
    if (draft.status !== 'pending') {
      throw new ConflictException(
        clubOrderError(
          CLUB_ORDER_ERROR_CODE.STATUS_CONFIRM_NOT_ALLOWED,
          '订单当前状态不可发起支付',
        ),
      );
    }
    if (draft.expiresAtMs <= Date.now()) {
      throw new ConflictException(
        clubOrderError(
          CLUB_ORDER_ERROR_CODE.STATUS_CONFIRM_NOT_ALLOWED,
          '订单已超时关闭，请重新下单',
        ),
      );
    }
  }

  confirmOrderPaid(
    currentContext: ClubCurrentContext,
    orderNo: string,
  ): Promise<ClubServiceOrderResponseDto> {
    return this.paymentConfirmationOrchestrator.confirmOrderPaid(
      currentContext,
      orderNo,
    );
  }

  confirmOrderPaidByCallback(
    orderNo: string,
    params: ClubPaymentCallbackSettlementParams,
  ): Promise<ClubServiceOrderResponseDto> {
    return this.paymentConfirmationOrchestrator.confirmOrderPaidByCallback(
      orderNo,
      params,
    );
  }
}
