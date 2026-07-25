import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { STORE_SUB_ACCOUNT_ROLE_LABELS } from '../access-control/access-control.constants';
import { AccessControlService } from '../access-control/access-control.service';
import {
  buildStoreResponseDto,
  type StoreResponseDto,
} from '../stores/dto/store-response.dto';
import {
  toNullableMediaText,
  toOptionalMediaText,
} from '../commerce/commerce.utils';
import { AuthAccountLookupService } from './auth-account-lookup.service';
import { AuthMembershipResolverService } from './auth-membership-resolver.service';
import { CacheInvalidatorService } from '../../redis/invalidator';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { ProfileResponseDto } from './dto/profile-response.dto';
import type {
  ProfileMembershipRecord,
  ProfileUserRecord,
} from './auth-profile.types';
import type { AuthenticatedUser } from './strategies/jwt.strategy';
import {
  buildUserCacheKey,
  getDisplayPhone,
  isVerifiedUser,
  maskIdNumber,
} from './auth.utils';

@Injectable()
export class AuthProfileService {
  private readonly logger = new Logger(AuthProfileService.name);

  constructor(
    private readonly authAccountLookupService: AuthAccountLookupService,
    private readonly authMembershipResolverService: AuthMembershipResolverService,
    private readonly accessControlService: AccessControlService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  async getProfile(user: AuthenticatedUser): Promise<ProfileResponseDto> {
    const [profileUser, currentMembership] = await Promise.all([
      this.authAccountLookupService.findProfileUserOrThrow(user.id),
      this.authMembershipResolverService.findCurrentMembership(user),
    ]);

    return this.buildProfileResponse(user, profileUser, currentMembership);
  }

  async updateAvatar(
    user: AuthenticatedUser,
    avatar: string | undefined,
  ): Promise<ProfileResponseDto> {
    await this.writeAvatar(user.id, toNullableMediaText(avatar) ?? null);
    return this.getProfile(user);
  }

  async updateNickname(
    user: AuthenticatedUser,
    nickname: string,
  ): Promise<ProfileResponseDto> {
    await this.writeName(user.id, nickname.trim());
    return this.getProfile(user);
  }

  async verifyRealName(
    user: AuthenticatedUser,
    realName: string,
    idNumber: string,
  ): Promise<ProfileResponseDto> {
    await this.writeRealName(user.id, realName, idNumber);
    await this.cacheInvalidatorService.invalidatePulseOnboardingStatusByUser(
      user.id,
    );
    return this.getProfile(user);
  }

  private async buildProfileResponse(
    user: AuthenticatedUser,
    profileUser: ProfileUserRecord,
    currentMembership: ProfileMembershipRecord | null,
  ): Promise<ProfileResponseDto> {
    const store = currentMembership
      ? await this.buildCurrentStore(currentMembership)
      : null;

    return {
      user: {
        id: profileUser.id,
        phone: getDisplayPhone(user.phone),
        email: profileUser.email,
        name: profileUser.name,
        avatar: toOptionalMediaText(profileUser.avatar) ?? '',
        verified: isVerifiedUser(profileUser),
        ...(profileUser.realName ? { realName: profileUser.realName } : {}),
        ...(profileUser.idNumber
          ? { idNumberMasked: maskIdNumber(profileUser.idNumber) }
          : {}),
        createdAt: profileUser.createdAt,
        updatedAt: profileUser.updatedAt,
      },
      store,
      currentMembership: currentMembership
        ? (() => {
            const activeMembership =
              user.currentMembership?.staffId === currentMembership.staffId
                ? user.currentMembership
                : null;

            return {
              identityType:
                currentMembership.identityType ??
                activeMembership?.subjectType ??
                'staff',
              ...(currentMembership.subAccountRole
                ? {
                    subAccountRole: currentMembership.subAccountRole,
                    subAccountRoleLabel:
                      STORE_SUB_ACCOUNT_ROLE_LABELS[
                        currentMembership.subAccountRole
                      ],
                  }
                : {}),
              staffId: currentMembership.staffId,
              ...(activeMembership?.linkedEmployeeId !== null &&
              activeMembership?.linkedEmployeeId !== undefined
                ? { linkedEmployeeId: activeMembership.linkedEmployeeId }
                : {}),
              storeId: currentMembership.storeId,
              role: currentMembership.role,
              permissions: activeMembership
                ? activeMembership.permissions
                : this.accessControlService.getEffectivePermissions({
                    role: currentMembership.role,
                    permissions: currentMembership.permissions,
                  }),
              isActive: currentMembership.isActive,
              ...(activeMembership?.subAccountId !== null &&
              activeMembership?.subAccountId !== undefined
                ? { subAccountId: activeMembership.subAccountId }
                : {}),
              ...(activeMembership?.subAccountStatus
                ? { subAccountStatus: activeMembership.subAccountStatus }
                : {}),
              ...(activeMembership?.subAccountAssigned !== undefined
                ? { subAccountAssigned: activeMembership.subAccountAssigned }
                : {}),
              ...(activeMembership?.canAccessHome !== undefined
                ? { canAccessHome: activeMembership.canAccessHome }
                : {}),
              ...(activeMembership?.canUseHandover !== undefined
                ? { canUseHandover: activeMembership.canUseHandover }
                : {}),
            };
          })()
        : null,
    };
  }

  // ─── Profile mutations (moved from AuthAccountLookupService) ───

  private async writeAvatar(
    userId: number,
    avatar: string | null,
  ): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { avatar },
    });
    await this.invalidateUserCache(userId);

    // 同步头像到关联的营销顾客记录（best-effort）
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { wechatPhone: true, email: true },
    });

    const phoneConditions: string[] = [];
    if (user?.wechatPhone) phoneConditions.push(user.wechatPhone);

    if (user?.email) {
      const clubMatch = user.email.match(/^club_phone_(\d+)@/);
      const legacyMatch = user.email.match(/^phone_(\d+)@/);
      if (clubMatch?.[1]) phoneConditions.push(clubMatch[1]);
      if (legacyMatch?.[1]) phoneConditions.push(legacyMatch[1]);
    }

    if (phoneConditions.length > 0) {
      await this.prisma.marketingCustomer
        .updateMany({
          where: { phone: { in: phoneConditions } },
          data: { avatar },
        })
        .catch(() => {
          /* best-effort，不影响主流程 */
        });
    }
  }

  private async writeName(userId: number, name: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { name },
    });
    await this.invalidateUserCache(userId);

    // 同步更新关联的 Staff 记录名称
    const updatedStaffs = await this.prisma.staff.findMany({
      where: { userId },
      select: { id: true },
    });
    if (updatedStaffs.length > 0) {
      const staffIds = updatedStaffs.map((s) => s.id);
      await this.prisma.staff.updateMany({
        where: { id: { in: staffIds } },
        data: { name },
      });

      // 同步更新关联的 Employee 记录名称
      await this.prisma.employee.updateMany({
        where: { linkedStaffId: { in: staffIds } },
        data: { name },
      });
    }
  }

  private async writeRealName(
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

    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: { realName, idNumber },
      });
      await this.invalidateUserCache(userId);
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('该身份证号码已完成实名认证');
      }
      throw error;
    }
  }

  // ─── Wechat mutations (moved from AuthAccountLookupService) ───

  async updateWechatProfile(
    userId: number,
    params: { nickname?: string; avatar?: string; unionid?: string },
  ): Promise<void> {
    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, avatar: true },
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(params.nickname != null && {
          wechatNickname: params.nickname,
          ...(currentUser?.name ? {} : { name: params.nickname }),
        }),
        ...(params.avatar != null && {
          wechatAvatar: params.avatar,
          ...(currentUser?.avatar ? {} : { avatar: params.avatar }),
        }),
        ...(params.unionid != null && { wechatUnionid: params.unionid }),
      },
    });
    await this.invalidateUserCache(userId);
  }

  async updateWechatPhone(userId: number, phone: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { wechatPhone: phone },
    });
    await this.invalidateUserCache(userId);
  }

  async bindWechatToUser(
    userId: number,
    params: {
      openid: string;
      unionid?: string;
      nickname?: string;
      avatar?: string;
      phone?: string;
    },
  ): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        wechatOpenid: params.openid,
        ...(params.unionid != null && { wechatUnionid: params.unionid }),
        ...(params.nickname != null && { wechatNickname: params.nickname }),
        ...(params.avatar != null && { wechatAvatar: params.avatar }),
        ...(params.phone != null && { wechatPhone: params.phone }),
      },
    });
    await this.invalidateUserCache(userId);
  }

  // ─── Shared utilities ───

  private async invalidateUserCache(userId: number): Promise<void> {
    try {
      await this.redisService.del(buildUserCacheKey(userId));
    } catch (error: unknown) {
      this.logger.warn(
        `[AuthProfileService] 失效用户 ${userId} 缓存失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async buildCurrentStore(
    currentMembership: Pick<
      ProfileMembershipRecord,
      | 'storeId'
      | 'storeName'
      | 'address'
      | 'businessMode'
      | 'storeCreatedAt'
      | 'storeUpdatedAt'
    >,
  ): Promise<StoreResponseDto> {
    return buildStoreResponseDto(
      {
        id: currentMembership.storeId,
        name: currentMembership.storeName,
        address: currentMembership.address,
        businessMode: currentMembership.businessMode,
        createdAt: currentMembership.storeCreatedAt,
        updatedAt: currentMembership.storeUpdatedAt,
      },
      await this.authMembershipResolverService.readStoreProfileMetadata(
        currentMembership.storeId,
      ),
    );
  }
}
