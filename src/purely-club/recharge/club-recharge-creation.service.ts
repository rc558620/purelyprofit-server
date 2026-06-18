import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { ClubOrderDraftsService } from '../orders/club-order-drafts.service';
import { buildOrderNo } from '../orders/club-order-drafts.utils';
import type { ClubRechargeOrderMetadata } from '../orders/club-order-drafts.types';
import {
  type ClubRechargeOrderResponseDto,
  type ClubRechargePackageDto,
  type CreateClubRechargeOrderDto,
} from './dto/club-recharge.dto';
import { toClubRechargeOrderResponse } from './club-recharge.mapper';
import { ClubRechargePackagesService } from './club-recharge-packages.service';
import { ClubRechargeContextService } from './club-recharge-context.service';
import type { ResolvedRechargeOrderSelection } from './club-recharge.types';
import {
  CLUB_CUSTOM_AMOUNT_MAX,
  CLUB_CUSTOM_AMOUNT_MIN,
  CLUB_RECHARGE_PACKAGE_NOT_FOUND_MESSAGE,
} from './club-recharge.constants';
import { convertYuanToFen } from './club-recharge.utils';
import { ClubWechatJsapiService } from '../payments/club-wechat-jsapi.service';

@Injectable()
export class ClubRechargeCreationService {
  constructor(
    private readonly clubRechargeContextService: ClubRechargeContextService,
    private readonly clubRechargePackagesService: ClubRechargePackagesService,
    private readonly clubOrderDraftsService: ClubOrderDraftsService,
    private readonly clubWechatJsapiService: ClubWechatJsapiService,
  ) {}

  async createOrder(
    currentContext: ClubCurrentContext,
    dto: CreateClubRechargeOrderDto,
  ): Promise<ClubRechargeOrderResponseDto> {
    this.assertSameCurrentStore(currentContext, dto.storeId);
    const customer =
      await this.clubRechargeContextService.requireCurrentCustomer(
        currentContext.store.id,
        currentContext.user.phone,
      );
    const packages =
      await this.clubRechargePackagesService.loadPackagesForStore(
        currentContext.store.id,
      );
    const selection = this.resolveRechargeOrderSelection(dto, packages);

    // 预生成订单号以保证 JSAPI out_trade_no 与 draft orderNo 一致
    const now = Date.now();
    const orderNo = buildOrderNo('recharge', now);

    // 若前端传入 openid，则调用微信 JSAPI 真实下单；否则走开发态 mock
    const paymentParams = dto.openid
      ? await this.clubWechatJsapiService.createJsapiPaymentParams({
          storeId: currentContext.store.id,
          orderNo,
          description: '会员充值',
          amountFen: selection.rechargeAmountFen,
          openid: dto.openid,
        })
      : undefined;

    const draft = await this.clubOrderDraftsService.createDraft<
      ClubRechargeOrderMetadata,
      'recharge'
    >({
      user: currentContext.user,
      orderType: 'recharge',
      storeId: currentContext.store.id,
      storeName: currentContext.store.name,
      customerId: customer.id,
      title: '会员充值',
      amountFen: selection.rechargeAmountFen,
      metadata: selection,
      orderNo,
      paymentParams,
    });

    return toClubRechargeOrderResponse(
      this.clubOrderDraftsService.toOrderStatusResponse(draft),
      draft,
    );
  }

  private resolveRechargeOrderSelection(
    dto: CreateClubRechargeOrderDto,
    packages: ClubRechargePackageDto[],
  ): ResolvedRechargeOrderSelection {
    const hasPackageId =
      typeof dto.packageId === 'string' && dto.packageId.trim().length > 0;
    const hasCustomAmount = typeof dto.customAmount === 'number';

    if (hasPackageId === hasCustomAmount) {
      throw new BadRequestException('packageId 和 customAmount 必须二选一');
    }

    if (hasPackageId) {
      return this.resolvePackageSelection(dto.packageId!, packages);
    }

    return this.resolveCustomAmountSelection(dto.customAmount!);
  }

  private resolvePackageSelection(
    packageId: string,
    packages: ClubRechargePackageDto[],
  ): ResolvedRechargeOrderSelection {
    const matchedPackage = packages.find((item) => item.id === packageId);
    if (!matchedPackage) {
      throw new NotFoundException(CLUB_RECHARGE_PACKAGE_NOT_FOUND_MESSAGE);
    }

    return {
      packageId: matchedPackage.id,
      promotionId: this.resolvePromotionIdFromPackageId(matchedPackage.id),
      rechargeAmountFen: convertYuanToFen(matchedPackage.amount),
      bonusAmountFen: convertYuanToFen(matchedPackage.bonusAmount),
      customAmountFen: null,
    };
  }

  private resolveCustomAmountSelection(
    customAmount: number,
  ): ResolvedRechargeOrderSelection {
    if (
      customAmount < CLUB_CUSTOM_AMOUNT_MIN ||
      customAmount > CLUB_CUSTOM_AMOUNT_MAX
    ) {
      throw new BadRequestException(
        `自定义充值金额需在 ${CLUB_CUSTOM_AMOUNT_MIN}-${CLUB_CUSTOM_AMOUNT_MAX} 元之间`,
      );
    }

    return {
      packageId: null,
      promotionId: null,
      rechargeAmountFen: convertYuanToFen(customAmount),
      bonusAmountFen: 0,
      customAmountFen: convertYuanToFen(customAmount),
    };
  }

  private resolvePromotionIdFromPackageId(packageId: string): number | null {
    const matched = /^(\d+)(?::\d+)?$/.exec(packageId.trim());
    if (!matched) {
      return null;
    }

    return Number.parseInt(matched[1], 10);
  }

  private assertSameCurrentStore(
    currentContext: ClubCurrentContext,
    requestedStoreId: number,
  ): void {
    if (currentContext.store.id !== requestedStoreId) {
      throw new BadRequestException('当前门店已切换，请刷新页面后重试');
    }
  }
}
