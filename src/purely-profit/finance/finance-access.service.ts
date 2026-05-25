import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PlatformMembershipAccessService } from '../member/platform-membership/platform-membership-access.service';

@Injectable()
export class FinanceAccessService {
  constructor(
    private readonly platformMembershipAccessService: PlatformMembershipAccessService,
  ) {}

  getCurrentStoreIdOrThrow(user: AuthenticatedUser): number {
    const storeId = user.currentMembership?.storeId;
    if (!storeId) {
      throw new ForbiddenException('当前账号暂无门店权限');
    }
    return storeId;
  }

  async getFinanceStoreIdOrThrow(user: AuthenticatedUser): Promise<number> {
    const storeId = this.getCurrentStoreIdOrThrow(user);
    await this.platformMembershipAccessService.ensureFinanceFeatureEnabled(
      storeId,
    );
    return storeId;
  }
}
