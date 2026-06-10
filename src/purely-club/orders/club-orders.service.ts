import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { calcCustomerTier } from '../../purely-profit/marketing/marketing.utils';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../redis/invalidator';
import { ClubStoresService } from '../stores/club-stores.service';
import { ClubOrderDraftsService } from './club-order-drafts.service';
import type {
  ClubOrderStatusResponseDto,
  ClubServiceOrderResponseDto,
  CreateClubServiceOrderDto,
} from './dto/club-order.dto';
import type {
  ClubOrderDraftPayload,
  ClubOrderPaidObservationOptions,
  ClubServiceOrderMetadata,
} from './club-order-drafts.types';

const CLUB_MEMBER_NOT_FOUND_MESSAGE = '当前门店下找不到会员档案';
const CLUB_PRODUCT_NOT_FOUND_MESSAGE = '当前门店下找不到可购买的服务商品';
const CLUB_SERVICE_CONFIRM_NOT_ALLOWED_MESSAGE = '当前订单状态不支持确认支付';

@Injectable()
export class ClubOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly clubStoresService: ClubStoresService,
    private readonly clubOrderDraftsService: ClubOrderDraftsService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
  ) {}

  async createServiceOrder(
    user: AuthenticatedUser,
    dto: CreateClubServiceOrderDto,
  ): Promise<ClubServiceOrderResponseDto> {
    const currentStore = await this.clubStoresService.getCurrent(user);
    this.assertSameCurrentStore(currentStore.id, dto.storeId);

    const [customer, product] = await Promise.all([
      this.prisma.marketingCustomer.findUnique({
        where: {
          storeId_phone: {
            storeId: currentStore.id,
            phone: user.phone,
          },
        },
        select: {
          id: true,
        },
      }),
      this.prisma.marketingProduct.findFirst({
        where: {
          id: dto.productId,
          storeId: currentStore.id,
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          price: true,
          originalPrice: true,
          image: true,
          stock: true,
        },
      }),
    ]);

    if (!customer) {
      throw new NotFoundException(CLUB_MEMBER_NOT_FOUND_MESSAGE);
    }

    if (!product || product.stock <= 0) {
      throw new NotFoundException(CLUB_PRODUCT_NOT_FOUND_MESSAGE);
    }

    const draft = await this.clubOrderDraftsService.createDraft({
      user,
      orderType: 'service',
      storeId: currentStore.id,
      storeName: currentStore.name,
      customerId: customer.id,
      title: `购买${product.name}`,
      amountFen: product.price,
      metadata: {
        productId: product.id,
        productName: product.name,
        originalAmountFen: product.originalPrice ?? product.price,
        coverImage: product.image?.trim() || null,
      },
    });

    return this.clubOrderDraftsService.toServiceOrderResponse(draft);
  }

  async getOrderStatus(
    user: AuthenticatedUser,
    orderId: string,
  ): Promise<ClubOrderStatusResponseDto> {
    const draft = await this.clubOrderDraftsService.getDraft(
      user,
      orderId,
      'service',
    );
    return this.clubOrderDraftsService.toOrderStatusResponse(draft);
  }

  async confirmOrderPaid(
    user: AuthenticatedUser,
    orderId: string,
  ): Promise<ClubServiceOrderResponseDto> {
    this.ensureManualConfirmPaidEnabled();
    const draft = await this.clubOrderDraftsService.getDraft<
      ClubServiceOrderMetadata,
      'service'
    >(user, orderId, 'service');
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
  ): Promise<ClubServiceOrderResponseDto> {
    const draft = await this.clubOrderDraftsService.getDraftByOrderId<
      ClubServiceOrderMetadata,
      'service'
    >(orderId, 'service');

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

  private async completePaidDraft(
    draft: ClubOrderDraftPayload<ClubServiceOrderMetadata, 'service'>,
    paymentMeta?: ClubOrderPaidObservationOptions,
  ): Promise<ClubServiceOrderResponseDto> {
    if (draft.status === 'paid') {
      const shouldRefreshPaidObservation =
        paymentMeta?.paymentConfirmationSource === 'wechat_callback' ||
        paymentMeta?.paymentTransactionId != null ||
        paymentMeta?.callbackReceivedAtMs != null;
      const observedPaidDraft = shouldRefreshPaidObservation
        ? await this.clubOrderDraftsService.markPaid(draft, paymentMeta)
        : draft;
      return this.clubOrderDraftsService.toServiceOrderResponse(
        observedPaidDraft,
      );
    }

    this.assertDraftPayable(draft.status);

    if (!draft.customerId) {
      throw new NotFoundException(CLUB_MEMBER_NOT_FOUND_MESSAGE);
    }

    await this.prisma.$transaction(async (tx) => {
      const customer = await tx.marketingCustomer.findFirst({
        where: {
          id: draft.customerId ?? undefined,
          storeId: draft.storeId,
        },
        select: {
          id: true,
          totalSpent: true,
        },
      });

      if (!customer) {
        throw new NotFoundException(CLUB_MEMBER_NOT_FOUND_MESSAGE);
      }

      const product = await tx.marketingProduct.findFirst({
        where: {
          id: draft.metadata.productId,
          storeId: draft.storeId,
          isActive: true,
        },
        select: {
          id: true,
          stock: true,
        },
      });

      if (!product || product.stock <= 0) {
        throw new NotFoundException(CLUB_PRODUCT_NOT_FOUND_MESSAGE);
      }

      await tx.marketingConsumption.create({
        data: {
          storeId: draft.storeId,
          customerId: customer.id,
          amount: draft.amountFen,
          balancePaid: 0,
          pointsDeducted: 0,
          payType: 'wechat',
          itemsSummary: draft.metadata.productName,
          promotionId: null,
        },
      });

      const newTotalSpent = customer.totalSpent + draft.amountFen;
      await tx.marketingCustomer.update({
        where: { id: customer.id },
        data: {
          totalSpent: { increment: draft.amountFen },
          visitCount: { increment: 1 },
          lastVisitAt: new Date(),
          tier: calcCustomerTier(newTotalSpent) as never,
        },
      });

      await tx.marketingProduct.updateMany({
        where: {
          id: draft.metadata.productId,
          storeId: draft.storeId,
        },
        data: {
          stock: { decrement: 1 },
        },
      });
    });

    await this.cacheInvalidatorService.invalidateMarketingOverview(
      draft.storeId,
    );
    const paidDraft = await this.clubOrderDraftsService.markPaid(
      draft,
      paymentMeta,
    );
    return this.clubOrderDraftsService.toServiceOrderResponse(paidDraft);
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
      throw new BadRequestException(CLUB_SERVICE_CONFIRM_NOT_ALLOWED_MESSAGE);
    }
  }
}
