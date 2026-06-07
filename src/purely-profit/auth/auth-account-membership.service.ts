import { Injectable, UnauthorizedException } from '@nestjs/common';
import { StaffStatus, type Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import {
  normalizeStoreProfileMetadata,
  type StoreProfileMetadata,
} from '../stores/dto/store-response.dto';
import type { ProfileMembershipRecord } from './auth-profile.types';
import type { AuthenticatedUser } from './strategies/jwt.strategy';
import {
  buildPulseAdminMemberBanReasonKey,
  buildStoreProfileKey,
} from './auth.utils';

@Injectable()
export class AuthAccountMembershipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  async ensureUserNotBanned(userId: number): Promise<void> {
    const relatedStoreIds = await this.findUserRelatedStoreIds(userId);
    if (relatedStoreIds.length === 0) {
      return;
    }

    const banReasons = await Promise.all(
      relatedStoreIds.map((storeId) =>
        this.redisService.get(buildPulseAdminMemberBanReasonKey(storeId)),
      ),
    );
    const hasBannedStore = banReasons.some((reason) => Boolean(reason?.trim()));

    if (hasBannedStore) {
      throw new UnauthorizedException('账号已被封禁');
    }
  }

  async findCurrentMembership(
    user: AuthenticatedUser,
  ): Promise<ProfileMembershipRecord | null> {
    if (!user.currentMembership) {
      return null;
    }

    const membership = await this.prisma.$queryRaw<
      Pick<
        ProfileMembershipRecord,
        'storeName' | 'address' | 'storeCreatedAt' | 'storeUpdatedAt'
      >[]
    >`
      SELECT
        s.name AS "storeName",
        s.address,
        s.created_at AS "storeCreatedAt",
        s.updated_at AS "storeUpdatedAt"
      FROM staffs st
      INNER JOIN stores s ON s.id = st.store_id
      WHERE st.id = ${user.currentMembership.staffId}
        AND st.store_id = ${user.currentMembership.storeId}
      LIMIT 1
    `;

    const currentStore = membership[0];
    if (!currentStore) {
      return null;
    }

    return {
      staffId: user.currentMembership.staffId,
      storeId: user.currentMembership.storeId,
      role: user.currentMembership.role,
      permissions: user.currentMembership.permissions,
      isActive: user.currentMembership.isActive,
      identityType: user.currentMembership.subjectType,
      subAccountRole: user.currentMembership.subAccountRole,
      ...currentStore,
    };
  }

  async readStoreProfileMetadata(
    storeId: number,
  ): Promise<StoreProfileMetadata> {
    try {
      const raw = await this.redisService.get(buildStoreProfileKey(storeId));
      if (!raw) {
        return normalizeStoreProfileMetadata(null);
      }

      return normalizeStoreProfileMetadata(JSON.parse(raw));
    } catch {
      return normalizeStoreProfileMetadata(null);
    }
  }

  async activateInvitedStaffMemberships(
    userId: number,
    identifiers: { phone: string; email: string },
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const invitedStaffs = await tx.staff.findMany({
        where: {
          OR: [
            { userId },
            { email: identifiers.email },
            { phone: identifiers.phone },
          ],
          status: StaffStatus.INVITED,
          isActive: true,
        },
        select: {
          id: true,
          storeId: true,
        },
        orderBy: [{ storeId: 'asc' }, { id: 'asc' }],
      });

      if (invitedStaffs.length === 0) {
        return;
      }

      const activatableStaffIds = await this.resolveActivatableStaffIds(
        tx,
        invitedStaffs,
      );

      if (activatableStaffIds.length === 0) {
        return;
      }

      await tx.staff.updateMany({
        where: {
          id: {
            in: activatableStaffIds,
          },
        },
        data: {
          userId,
          status: StaffStatus.ACTIVE,
          isSeatActive: true,
          isActive: true,
        },
      });
    });
  }

  private async findUserRelatedStoreIds(userId: number): Promise<number[]> {
    const stores = await this.prisma.store.findMany({
      where: {
        OR: [
          { ownerId: userId },
          {
            staffs: {
              some: {
                userId,
                isActive: true,
              },
            },
          },
        ],
      },
      select: {
        id: true,
      },
      orderBy: {
        id: 'asc',
      },
    });

    return stores.map((store) => store.id);
  }

  private async resolveActivatableStaffIds(
    tx: Prisma.TransactionClient,
    invitedStaffs: Array<{ id: number; storeId: number }>,
  ): Promise<number[]> {
    const [firstInvitedStaff] = invitedStaffs;
    if (!firstInvitedStaff) {
      return [];
    }

    const store = await tx.store.findUnique({
      where: { id: firstInvitedStaff.storeId },
      select: {
        id: true,
        maxAccountSeats: true,
      },
    });

    if (!store) {
      return [];
    }

    const activeSeatCount = await tx.staff.count({
      where: {
        storeId: store.id,
        status: StaffStatus.ACTIVE,
        isSeatActive: true,
        isActive: true,
      },
    });

    if (activeSeatCount >= store.maxAccountSeats) {
      return [];
    }

    return [firstInvitedStaff.id];
  }
}
