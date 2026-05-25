import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { PulseStoreContextService } from '../pulse-store-context.service';
import type { OnboardingStatusResponseDto } from './dto/onboarding-status.dto';
import type {
  MembershipProfileRow,
  MerchantVerificationRow,
} from './onboarding.utils';
import { isActiveMembership } from './onboarding.utils';

@Injectable()
export class OnboardingStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pulseStoreContextService: PulseStoreContextService,
  ) {}

  async getStatus(
    user: AuthenticatedUser,
  ): Promise<OnboardingStatusResponseDto> {
    const resolvedStore =
      await this.pulseStoreContextService.resolveTargetStore(user);
    const targetStore = resolvedStore.store;

    const [merchantVerification, membership] = await Promise.all([
      targetStore
        ? this.findMerchantVerification(targetStore.ownerId)
        : Promise.resolve(null),
      targetStore
        ? this.findMembershipProfile(targetStore.id)
        : Promise.resolve(null),
    ]);

    const hasSelectedStore = targetStore !== null;
    const hasVerifiedRealName = Boolean(
      merchantVerification?.realName && merchantVerification.idNumber,
    );
    const hasMembership = isActiveMembership(membership);
    const isReady = hasVerifiedRealName && hasSelectedStore && hasMembership;

    return {
      isCompleted: isReady,
      steps: {
        hasRegistered: true,
        hasVerifiedRealName,
        hasCreatedStore: hasSelectedStore,
        hasMembership,
      },
      targetStatus: {
        isReady,
        storeSelected: hasSelectedStore,
        merchantVerified: hasVerifiedRealName,
        membershipActive: hasMembership,
        storeId: targetStore?.id ?? null,
        storeName: targetStore?.name ?? null,
      },
      storeId: targetStore?.id ?? null,
      storeName: targetStore?.name ?? null,
    };
  }

  private async findMerchantVerification(
    userId: number,
  ): Promise<MerchantVerificationRow | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { realName: true, idNumber: true },
    });

    return user ?? null;
  }

  private async findMembershipProfile(
    storeId: number,
  ): Promise<MembershipProfileRow | null> {
    const profile = await this.prisma.storeMembershipProfile.findUnique({
      where: { storeId },
      select: { currentPlanId: true, expiresAt: true },
    });

    return profile ?? null;
  }
}
