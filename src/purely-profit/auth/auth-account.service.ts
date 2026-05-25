import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { StaffStatus, type Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import {
  normalizeStoreProfileMetadata,
  type StoreProfileMetadata,
} from '../stores/dto/store-response.dto';
import type { AuthenticatedUser } from './strategies/jwt.strategy';
import type { AccountIdentifiers, PhoneUserRecord } from './auth-account.types';
import type {
  ProfileMembershipRecord,
  ProfileUserRecord,
} from './auth-profile.types';
import {
  buildAccountIdentifiers,
  buildPulseAdminMemberBanReasonKey,
  buildStoreProfileKey,
  resolveLoginPhone,
} from './auth.utils';

@Injectable()
export class AuthAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  async findUserByLoginAccount(
    account: string,
  ): Promise<PhoneUserRecord | null> {
    const loginPhone = resolveLoginPhone(account);
    if (!loginPhone) {
      return null;
    }

    return this.findUserByPhone(loginPhone);
  }

  async findUserByPhone(phone: string): Promise<PhoneUserRecord | null> {
    const staff = await this.prisma.staff.findFirst({
      where: {
        phone,
        isActive: true,
        userId: { not: null },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: {
        user: {
          select: {
            id: true,
            email: true,
            password: true,
          },
        },
      },
    });

    if (staff?.user) {
      return {
        ...staff.user,
        phone,
      };
    }

    const aliasEmail = buildAccountIdentifiers(phone).email;
    const aliasUser = await this.prisma.user.findUnique({
      where: { email: aliasEmail },
      select: {
        id: true,
        email: true,
        password: true,
      },
    });

    return aliasUser
      ? {
          ...aliasUser,
          phone,
        }
      : null;
  }

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

  async findProfileUserOrThrow(userId: number): Promise<ProfileUserRecord> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        realName: true,
        idNumber: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    return user;
  }

  async findCurrentMembership(
    user: AuthenticatedUser,
  ): Promise<ProfileMembershipRecord | null> {
    const memberships = await this.prisma.$queryRaw<ProfileMembershipRecord[]>`
      SELECT
        st.id AS "staffId",
        st.store_id AS "storeId",
        st.role,
        st.permissions,
        st.is_active AS "isActive",
        s.name AS "storeName",
        s.address,
        s.created_at AS "storeCreatedAt",
        s.updated_at AS "storeUpdatedAt"
      FROM staffs st
      INNER JOIN stores s ON s.id = st.store_id
      WHERE st.is_active = true
        AND st.status = 'ACTIVE'
        AND (
          st.user_id = ${user.id}
          OR st.email = ${user.email}
          OR st.phone = ${user.phone}
        )
      ORDER BY
        CASE st.role
          WHEN 'OWNER' THEN 0
          WHEN 'MANAGER' THEN 1
          ELSE 2
        END,
        st.id ASC
      LIMIT 1
    `;

    return memberships[0] ?? null;
  }

  async updateAvatar(userId: number, avatar: string | null): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        avatar,
      },
    });
  }

  async verifyRealName(
    userId: number,
    realName: string,
    idNumber: string,
  ): Promise<void> {
    const existingVerifiedUser = await this.prisma.user.findFirst({
      where: {
        idNumber,
        id: { not: userId },
      },
      select: { id: true },
    });

    if (existingVerifiedUser) {
      throw new ConflictException('该身份证号码已完成实名认证');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        realName,
        idNumber,
      },
    });
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

  async syncStaffMemberships(
    userId: number,
    identifiers: AccountIdentifiers,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.staff.updateMany({
        where: {
          userId: null,
          OR: [{ email: identifiers.email }, { phone: identifiers.phone }],
        },
        data: {
          userId,
        },
      });

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
