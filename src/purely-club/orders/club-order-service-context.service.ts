import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import type { ClubEligibleFirstOrderPromotion } from './club-order-promotions.service';
import type { ClubServiceOrderMetadata } from './club-order-drafts.types';
import type { CreateClubServiceOrderDto } from './dto/club-order.dto';
import {
  CLUB_MEMBER_NOT_FOUND_MESSAGE,
  CLUB_PRODUCT_NOT_FOUND_MESSAGE,
} from './club-orders.constants';

interface ClubOrderStoreSummary {
  id: number;
  name: string;
}

interface ClubOrderCustomerSummary {
  id: number;
}

interface ClubOrderProductSummary {
  id: number;
  name: string;
  price: number;
  originalPrice: number | null;
  image: string | null;
  stock: number;
}

export interface ClubCreateServiceOrderContext {
  store: ClubOrderStoreSummary;
  customer: ClubOrderCustomerSummary;
  product: ClubOrderProductSummary;
}

@Injectable()
export class ClubOrderServiceContextService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveCreateServiceOrderContext(
    currentContext: ClubCurrentContext,
    dto: CreateClubServiceOrderDto,
  ): Promise<ClubCreateServiceOrderContext> {
    this.assertSameCurrentStore(currentContext, dto.storeId);

    const [customer, product] = await Promise.all([
      this.findCurrentStoreCustomer(
        currentContext.store.id,
        currentContext.user.phone,
      ),
      this.findActiveStoreProduct(currentContext.store.id, dto.productId),
    ]);

    if (!customer) {
      throw new NotFoundException(CLUB_MEMBER_NOT_FOUND_MESSAGE);
    }

    if (!product || product.stock <= 0) {
      throw new NotFoundException(CLUB_PRODUCT_NOT_FOUND_MESSAGE);
    }

    return {
      store: {
        id: currentContext.store.id,
        name: currentContext.store.name,
      },
      customer,
      product,
    };
  }

  buildDraftMetadata(
    product: ClubOrderProductSummary,
    eligiblePromotion: ClubEligibleFirstOrderPromotion | null,
  ): ClubServiceOrderMetadata {
    return {
      productId: product.id,
      productName: product.name,
      originalAmountFen: product.originalPrice ?? product.price,
      coverImage: product.image?.trim() || null,
      promotionId: eligiblePromotion?.id ?? null,
      promotionType: eligiblePromotion ? 'first_order_discount' : null,
      discountRate: eligiblePromotion?.discountRate ?? null,
      discountAmountFen: eligiblePromotion?.discountAmountFen ?? 0,
      promotionTag: eligiblePromotion?.tag ?? null,
    };
  }

  private async findCurrentStoreCustomer(
    storeId: number,
    phone: string,
  ): Promise<ClubOrderCustomerSummary | null> {
    return this.prisma.marketingCustomer.findUnique({
      where: {
        storeId_phone: {
          storeId,
          phone,
        },
      },
      select: {
        id: true,
      },
    });
  }

  private async findActiveStoreProduct(
    storeId: number,
    productId: number,
  ): Promise<ClubOrderProductSummary | null> {
    return this.prisma.marketingProduct.findFirst({
      where: {
        id: productId,
        storeId,
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
    });
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
