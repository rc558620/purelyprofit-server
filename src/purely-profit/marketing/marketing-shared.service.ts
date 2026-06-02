import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PlatformMembershipAccessService } from '../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { MarketingPermission } from './marketing-access.service';
import { MarketingAccessService } from './marketing-access.service';
import { queryCustomerRowById, queryPromotionRowById } from './marketing.query';
import type {
  MarketingCustomerRow,
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
}
