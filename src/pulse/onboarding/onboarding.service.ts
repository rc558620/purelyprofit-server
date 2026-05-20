import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import type { OnboardingStatusResponseDto } from './dto/onboarding-status.dto';

// ──────────────────────────────────────────────
// 本地内部类型
// ──────────────────────────────────────────────

interface UserVerificationRow {
  realName: string | null;
  idNumber: string | null;
}

interface StoreRow {
  id: number;
  name: string;
}

interface MembershipProfileRow {
  currentPlanId: string | null;
  expiresAt: Date | null;
}

@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  // ──────────────────────────────────────────────
  // GET /pulse/onboarding/status
  // ──────────────────────────────────────────────

  async getStatus(
    user: AuthenticatedUser,
  ): Promise<OnboardingStatusResponseDto> {
    const [userVerification, store] = await Promise.all([
      this.findUserVerification(user.id),
      this.findOwnerStore(user.id),
    ]);

    const membership = store
      ? await this.findMembershipProfile(store.id)
      : null;

    const hasVerifiedRealName = Boolean(
      userVerification?.realName && userVerification?.idNumber,
    );
    const hasCreatedStore = store !== null;
    const hasMembership = this.isActiveMembership(membership);

    const isCompleted = hasVerifiedRealName && hasCreatedStore && hasMembership;

    return {
      isCompleted,
      steps: {
        hasRegistered: true,
        hasVerifiedRealName,
        hasCreatedStore,
        hasMembership,
      },
      storeId: store?.id ?? null,
      storeName: store?.name ?? null,
    };
  }

  // ──────────────────────────────────────────────
  // 私有方法
  // ──────────────────────────────────────────────

  private async findUserVerification(
    userId: number,
  ): Promise<UserVerificationRow> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { realName: true, idNumber: true },
    });

    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    return user;
  }

  private async findOwnerStore(userId: number): Promise<StoreRow | null> {
    const store = await this.prisma.store.findUnique({
      where: { ownerId: userId },
      select: { id: true, name: true },
    });

    return store ?? null;
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

  private isActiveMembership(profile: MembershipProfileRow | null): boolean {
    if (!profile || !profile.currentPlanId) {
      return false;
    }

    if (!profile.expiresAt) {
      return false;
    }

    return profile.expiresAt > new Date();
  }
}
