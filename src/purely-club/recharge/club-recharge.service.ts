import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../redis/invalidator';
import { ClubOrderDraftsService } from '../orders/club-order-drafts.service';
import type { ClubOrderStatusResponseDto } from '../orders/dto/club-order.dto';
import type {
  ClubOrderDraftPayload,
  ClubOrderPaidObservationOptions,
  ClubRechargeOrderMetadata,
} from '../orders/club-order-drafts.types';
import { ClubStoresService } from '../stores/club-stores.service';
import type {
  ClubRechargeOrderResponseDto,
  ClubRechargePackageDto,
  ClubRechargePackagesResponseDto,
  CreateClubRechargeOrderDto,
  ListClubRechargePackagesQueryDto,
} from './dto/club-recharge.dto';
import { ClubRechargePackagesService } from './club-recharge-packages.service';
import type { ResolvedRechargeOrderSelection } from './club-recharge.types';
import {
  CLUB_RECHARGE_PREVIEW_COUNT,
  CLUB_CUSTOM_AMOUNT_MIN,
  CLUB_CUSTOM_AMOUNT_MAX,
  CLUB_MEMBER_NOT_FOUND_MESSAGE,
  CLUB_RECHARGE_PACKAGE_NOT_FOUND_MESSAGE,
  CLUB_RECHARGE_CONFIRM_NOT_ALLOWED_MESSAGE,
} from './club-recharge.constants';
import { convertFenToYuan, convertYuanToFen } from './club-recharge.utils';

@Injectable()
export class ClubRechargeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly clubStoresService: ClubStoresService,
    private readonly clubOrderDraftsService: ClubOrderDraftsService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly clubRechargePackagesService: ClubRechargePackagesService,
  ) {}

  async listPackages(
    user: AuthenticatedUser,
    query: ListClubRechargePackagesQueryDto,
  ): Promise<ClubRechargePackagesResponseDto> {
    const currentStore = await this.clubStoresService.getCurrent(user);
    const packages =
      await this.clubRechargePackagesService.loadPackagesForStore(
        currentStore.id,
      );

    return {
      items: query.preview
        ? packages.slice(0, CLUB_RECHARGE_PREVIEW_COUNT)
        : packages,
    };
  }

  async createOrder(
    user: AuthenticatedUser,
    dto: CreateClubRechargeOrderDto,
  ): Promise<ClubRechargeOrderResponseDto> {
    const currentStore = await this.clubStoresService.getCurrent(user);
    this.assertSameCurrentStore(currentStore.id, dto.storeId);

    const customer = await this.prisma.marketingCustomer.findUnique({
      where: {
        storeId_phone: {
          storeId: currentStore.id,
          phone: user.phone,
        },
      },
      select: {
        id: true,
      },
    });

    if (!customer) {
      throw new NotFoundException(CLUB_MEMBER_NOT_FOUND_MESSAGE);
    }

    const packages =
      await this.clubRechargePackagesService.loadPackagesForStore(
        currentStore.id,
      );
    const selection = this.resolveRechargeOrderSelection(dto, packages);
    const draft = await this.clubOrderDraftsService.createDraft({
      user,
      orderType: 'recharge',
      storeId: currentStore.id,
      storeName: currentStore.name,
      customerId: customer.id,
      title: '会员充值',
      amountFen: selection.rechargeAmountFen,
      metadata: selection,
    });

    return this.toRechargeOrderResponse(draft);
  }

  async getOrderStatus(
    user: AuthenticatedUser,
    orderId: string,
  ): Promise<ClubOrderStatusResponseDto> {
    const draft = await this.clubOrderDraftsService.getDraft(
      user,
      orderId,
      'recharge',
    );
    return this.clubOrderDraftsService.toOrderStatusResponse(draft);
  }

  async confirmOrderPaid(
    user: AuthenticatedUser,
    orderId: string,
  ): Promise<ClubRechargeOrderResponseDto> {
    this.ensureManualConfirmPaidEnabled();
    const draft = await this.clubOrderDraftsService.getDraft<
      ClubRechargeOrderMetadata,
      'recharge'
    >(user, orderId, 'recharge');
    return this.completePaidDraft(draft, {
      paymentConfirmationSource: 'manual_confirm_paid',
    });
  }

  async confirmOrderPaidByCallback(
    orderId: string,
    params: {
      amountFen: number;
      transactionId: string;
      paidAtMs: number;
      callbackReceivedAtMs: number;
    },
  ): Promise<ClubRechargeOrderResponseDto> {
    const draft = await this.clubOrderDraftsService.getDraftByOrderId<
      ClubRechargeOrderMetadata,
      'recharge'
    >(orderId, 'recharge');

    if (draft.amountFen !== params.amountFen) {
      throw new BadRequestException('回调金额与订单金额不一致');
    }

    return this.completePaidDraft(draft, {
      paidAtMs: params.paidAtMs,
      paymentTransactionId: params.transactionId,
      callbackReceivedAtMs: params.callbackReceivedAtMs,
      paymentConfirmationSource: 'wechat_callback',
    });
  }

  /**
   * 解析充值订单选择（套餐或自定义金额）
   */
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

  /**
   * 解析套餐选择
   */
  private resolvePackageSelection(
    packageId: string,
    packages: ClubRechargePackageDto[],
  ): ResolvedRechargeOrderSelection {
    const matchedPackage = packages.find((item) => item.id === packageId);
    if (!matchedPackage) {
      throw new NotFoundException(CLUB_RECHARGE_PACKAGE_NOT_FOUND_MESSAGE);
    }

    const promotionId = /^\d+$/.test(matchedPackage.id)
      ? Number.parseInt(matchedPackage.id, 10)
      : null;

    return {
      packageId: matchedPackage.id,
      promotionId,
      rechargeAmountFen: convertYuanToFen(matchedPackage.amount),
      bonusAmountFen: convertYuanToFen(matchedPackage.bonusAmount),
      customAmountFen: null,
    };
  }

  /**
   * 解析自定义金额选择
   */
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

  /**
   * 完成支付订单落账
   */
  private async completePaidDraft(
    draft: ClubOrderDraftPayload<ClubRechargeOrderMetadata, 'recharge'>,
    paymentMeta?: ClubOrderPaidObservationOptions,
  ): Promise<ClubRechargeOrderResponseDto> {
    if (draft.status === 'paid') {
      const shouldRefreshPaidObservation =
        paymentMeta?.paymentConfirmationSource === 'wechat_callback' ||
        paymentMeta?.paymentTransactionId != null ||
        paymentMeta?.callbackReceivedAtMs != null;
      const observedPaidDraft = shouldRefreshPaidObservation
        ? await this.clubOrderDraftsService.markPaid(draft, paymentMeta)
        : draft;
      return this.toRechargeOrderResponse(observedPaidDraft);
    }

    this.assertDraftPayable(draft.status);

    if (!draft.customerId) {
      throw new NotFoundException(CLUB_MEMBER_NOT_FOUND_MESSAGE);
    }

    await this.persistRechargeOrder(draft);
    await this.cacheInvalidatorService.invalidateMarketingOverview(
      draft.storeId,
    );

    const paidDraft = await this.clubOrderDraftsService.markPaid(
      draft,
      paymentMeta,
    );
    return this.toRechargeOrderResponse(paidDraft);
  }

  /**
   * 持久化充值订单（写库）
   */
  private async persistRechargeOrder(
    draft: ClubOrderDraftPayload<ClubRechargeOrderMetadata, 'recharge'>,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const customer = await tx.marketingCustomer.findFirst({
        where: {
          id: draft.customerId ?? undefined,
          storeId: draft.storeId,
        },
        select: { id: true },
      });

      if (!customer) {
        throw new NotFoundException(CLUB_MEMBER_NOT_FOUND_MESSAGE);
      }

      await tx.marketingRecharge.create({
        data: {
          storeId: draft.storeId,
          customerId: customer.id,
          amount: draft.metadata.rechargeAmountFen,
          giftAmount: draft.metadata.bonusAmountFen,
          type: 'recharge',
          promotionId: draft.metadata.promotionId,
          note: `club充值订单 ${draft.orderNo}`,
        },
      });

      await tx.marketingCustomer.update({
        where: { id: customer.id },
        data: {
          balance: {
            increment:
              draft.metadata.rechargeAmountFen + draft.metadata.bonusAmountFen,
          },
        },
      });

      if (draft.metadata.promotionId) {
        await tx.marketingPromotion.updateMany({
          where: {
            id: draft.metadata.promotionId,
            storeId: draft.storeId,
          },
          data: {
            usageCount: { increment: 1 },
          },
        });
      }
    });
  }

  /**
   * 转换为充值订单响应
   */
  private toRechargeOrderResponse(
    draft: ClubOrderDraftPayload<ClubRechargeOrderMetadata, 'recharge'>,
  ): ClubRechargeOrderResponseDto {
    const base = this.clubOrderDraftsService.toOrderStatusResponse(draft);
    return {
      ...base,
      rechargeAmount: convertFenToYuan(draft.metadata.rechargeAmountFen),
      bonusAmount: convertFenToYuan(draft.metadata.bonusAmountFen),
      packageId: draft.metadata.packageId,
      paymentParams: draft.paymentParams,
    };
  }

  private ensureManualConfirmPaidEnabled(): void {
    const enabled =
      this.configService.get<boolean>('club.manualConfirmPaidEnabled') ?? false;
    if (!enabled) {
      throw new ForbiddenException(
        'confirm-paid 仅开发态可用，请改用支付回调驱动订单状态刷新',
      );
    }
  }

  private assertSameCurrentStore(
    currentStoreId: number,
    inputStoreId: number,
  ): void {
    if (currentStoreId !== inputStoreId) {
      throw new BadRequestException('当前门店已切换，请刷新页面后重试');
    }
  }

  private assertDraftPayable(
    status: ClubOrderStatusResponseDto['status'],
  ): void {
    if (status !== 'pending') {
      throw new BadRequestException(CLUB_RECHARGE_CONFIRM_NOT_ALLOWED_MESSAGE);
    }
  }
}
