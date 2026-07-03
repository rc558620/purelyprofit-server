import { Injectable } from '@nestjs/common';
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
import { ProfileResponseDto } from './dto/profile-response.dto';
import type {
  ProfileMembershipRecord,
  ProfileUserRecord,
} from './auth-profile.types';
import type { AuthenticatedUser } from './strategies/jwt.strategy';
import { getDisplayPhone, isVerifiedUser, maskIdNumber } from './auth.utils';

@Injectable()
export class AuthProfileService {
  constructor(
    private readonly authAccountLookupService: AuthAccountLookupService,
    private readonly authMembershipResolverService: AuthMembershipResolverService,
    private readonly accessControlService: AccessControlService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
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
    await this.authAccountLookupService.updateAvatar(
      user.id,
      toNullableMediaText(avatar) ?? null,
    );

    return this.getProfile(user);
  }

  async updateNickname(
    user: AuthenticatedUser,
    nickname: string,
  ): Promise<ProfileResponseDto> {
    await this.authAccountLookupService.updateName(user.id, nickname.trim());
    return this.getProfile(user);
  }

  async verifyRealName(
    user: AuthenticatedUser,
    realName: string,
    idNumber: string,
  ): Promise<ProfileResponseDto> {
    await this.authAccountLookupService.verifyRealName(
      user.id,
      realName,
      idNumber,
    );
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

  private async buildCurrentStore(
    currentMembership: Pick<
      ProfileMembershipRecord,
      'storeId' | 'storeName' | 'address' | 'storeCreatedAt' | 'storeUpdatedAt'
    >,
  ): Promise<StoreResponseDto> {
    return buildStoreResponseDto(
      {
        id: currentMembership.storeId,
        name: currentMembership.storeName,
        address: currentMembership.address,
        createdAt: currentMembership.storeCreatedAt,
        updatedAt: currentMembership.storeUpdatedAt,
      },
      await this.authMembershipResolverService.readStoreProfileMetadata(
        currentMembership.storeId,
      ),
    );
  }
}
