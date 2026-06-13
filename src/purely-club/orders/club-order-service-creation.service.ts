import { Injectable } from '@nestjs/common';
import { ClubWechatJsapiService } from '../payments/club-wechat-jsapi.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { ClubOrderDraftsService } from './club-order-drafts.service';
import { ClubOrderPromotionsService } from './club-order-promotions.service';
import { ClubOrderServiceContextService } from './club-order-service-context.service';
import type {
  ClubServiceOrderResponseDto,
  CreateClubServiceOrderDto,
} from './dto/club-order.dto';

@Injectable()
export class ClubOrderServiceCreationService {
  constructor(
    private readonly clubOrderDraftsService: ClubOrderDraftsService,
    private readonly clubOrderPromotionsService: ClubOrderPromotionsService,
    private readonly clubOrderServiceContextService: ClubOrderServiceContextService,
    private readonly clubWechatJsapiService: ClubWechatJsapiService,
  ) {}

  async createServiceOrder(
    currentContext: ClubCurrentContext,
    dto: CreateClubServiceOrderDto,
  ): Promise<ClubServiceOrderResponseDto> {
    const context =
      await this.clubOrderServiceContextService.resolveCreateServiceOrderContext(
        currentContext,
        dto,
      );
    const pricing = await this.clubOrderPromotionsService.resolvePricing(
      context.store.id,
      context.customer.id,
      currentContext.user.phone,
      context.product.price,
    );
    const productName = context.product.name;

    // 预生成订单号保证 JSAPI out_trade_no 与 draft orderNo 一致
    const now = Date.now();
    const orderNo = this.buildServiceOrderNo(now);

    // 若前端传入 openid，则调用微信 JSAPI 真实下单
    const paymentParams = dto.openid
      ? await this.clubWechatJsapiService.createJsapiPaymentParams({
          storeId: context.store.id,
          orderNo,
          description: `购买${productName}`,
          amountFen: pricing.amountFen,
          openid: dto.openid,
        })
      : undefined;

    const draft = await this.clubOrderDraftsService.createDraft({
      user: currentContext.user,
      orderType: 'service',
      storeId: context.store.id,
      storeName: context.store.name,
      customerId: context.customer.id,
      title: `购买${productName}`,
      amountFen: pricing.amountFen,
      metadata: this.clubOrderServiceContextService.buildDraftMetadata(
        context.product,
        pricing,
      ),
      orderNo,
      paymentParams,
    });

    return this.clubOrderDraftsService.toServiceOrderResponse(draft);
  }

  /**
   * 预生成服务单号，格式与 club-order-drafts.utils 中的 buildOrderNo 一致：
   * SV{yyyyMMddHHmmssSSS}{4位随机HEX大写}
   */
  private buildServiceOrderNo(now: number): string {
    const date = new Date(now);
    const pad = (v: number, w = 2): string => String(v).padStart(w, '0');
    const serial = [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate()),
      pad(date.getHours()),
      pad(date.getMinutes()),
      pad(date.getSeconds()),
      pad(date.getMilliseconds(), 3),
      Math.floor(Math.random() * 0xffff)
        .toString(16)
        .padStart(4, '0')
        .toUpperCase(),
    ].join('');
    return `SV${serial}`;
  }
}
