import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PlatformMembershipAccessService } from '../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { MarketingPermission } from './marketing-access.service';
import { MarketingAccessService } from './marketing-access.service';
import { queryCustomerRowById, queryPromotionRowById } from './marketing.query';
import type {
  MarketingCustomerRow,
  MarketingProductCategoryRow,
  MarketingProductRow,
  MarketingPromotionRow,
} from './marketing.types';

@Injectable()
export class MarketingSharedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: MarketingAccessService,
    private readonly platformMembershipAccessService: PlatformMembershipAccessService,
  ) {}

  async resolveMembershipManagedStoreId(
    user: AuthenticatedUser,
    storeId?: number,
  ): Promise<number | null> {
    const resolvedStoreId = await this.accessService.resolveViewStoreId(
      user,
      storeId,
    );
    if (resolvedStoreId !== null) {
      const callerIsSubAccount =
        user.currentMembership?.subjectType === 'sub_account';
      await this.platformMembershipAccessService.ensureMarketingFeatureEnabled(
        resolvedStoreId,
        callerIsSubAccount,
      );
    }
    return resolvedStoreId;
  }

  async ensureMarketingStoreAccess(
    user: AuthenticatedUser,
    storeId: number,
    permission: MarketingPermission,
  ): Promise<void> {
    await this.accessService.ensureCanAccess(user, storeId, permission);
    const callerIsSubAccount =
      user.currentMembership?.subjectType === 'sub_account';
    await this.platformMembershipAccessService.ensureMarketingFeatureEnabled(
      storeId,
      callerIsSubAccount,
    );
  }

  async findCustomerOrThrow(customerId: number): Promise<MarketingCustomerRow> {
    const customer = await queryCustomerRowById(this.prisma, customerId);
    if (!customer) {
      throw new NotFoundException('顾客不存在');
    }
    return customer;
  }

  async findPromotionOrThrow(
    promotionId: number,
  ): Promise<MarketingPromotionRow> {
    const promotion = await queryPromotionRowById(this.prisma, promotionId);
    if (!promotion) {
      throw new NotFoundException('活动不存在');
    }
    return promotion;
  }

  async findProductCategoryOrThrow(
    categoryId: number,
  ): Promise<MarketingProductCategoryRow> {
    const category = await this.prisma.marketingProductCategory.findUnique({
      where: { id: categoryId },
    });
    if (!category) {
      throw new NotFoundException('产品分类不存在');
    }
    return category;
  }

  async findProductOrThrow(productId: number): Promise<MarketingProductRow> {
    const product = await this.prisma.marketingProduct.findUnique({
      where: { id: productId },
      include: {
        category: {
          select: {
            name: true,
          },
        },
      },
    });
    if (!product) {
      throw new NotFoundException('产品不存在');
    }

    return {
      id: product.id,
      storeId: product.storeId,
      categoryId: product.categoryId,
      categoryName: product.category.name,
      name: product.name,
      price: product.price,
      originalPrice: product.originalPrice,
      image: product.image,
      description: product.description,
      durationMinutes: product.durationMinutes,
      personCount: product.personCount,
      isActive: product.isActive,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    };
  }
}
