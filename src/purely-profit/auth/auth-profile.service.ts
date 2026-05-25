import { Injectable } from '@nestjs/common';
import { AccessControlService } from '../access-control/access-control.service';
import {
  buildStoreResponseDto,
  type StoreResponseDto,
} from '../stores/dto/store-response.dto';
import {
  toNullableMediaText,
  toOptionalMediaText,
} from '../commerce/commerce.utils';
import { AuthAccountService } from './auth-account.service';
import { ProfileResponseDto } from './dto/profile-response.dto';
import type {
  ProfileMembershipRecord,
  ProfileUserRecord,
} from './auth-profile.types';
import type { AuthenticatedUser } from './strategies/jwt.strategy';
import { isVerifiedUser, maskIdNumber } from './auth.utils';

@Injectable()
export class AuthProfileService {
  constructor(
    private readonly authAccountService: AuthAccountService,
    private readonly accessControlService: AccessControlService,
  ) {}

  async getProfile(user: AuthenticatedUser): Promise<ProfileResponseDto> {
    const [profileUser, currentMembership] = await Promise.all([
      this.authAccountService.findProfileUserOrThrow(user.id),
      this.authAccountService.findCurrentMembership(user),
    ]);

    return this.buildProfileResponse(user, profileUser, currentMembership);
  }

  async updateAvatar(
    user: AuthenticatedUser,
    avatar: string | undefined,
  ): Promise<ProfileResponseDto> {
    await this.authAccountService.updateAvatar(
      user.id,
      toNullableMediaText(avatar) ?? null,
    );

    return this.getProfile(user);
  }

  async verifyRealName(
    user: AuthenticatedUser,
    realName: string,
    idNumber: string,
  ): Promise<ProfileResponseDto> {
    await this.authAccountService.verifyRealName(user.id, realName, idNumber);
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
        phone: user.phone,
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
        ? {
            staffId: currentMembership.staffId,
            storeId: currentMembership.storeId,
            role: currentMembership.role,
            permissions: this.accessControlService.getEffectivePermissions({
              role: currentMembership.role,
              permissions: currentMembership.permissions,
            }),
            isActive: currentMembership.isActive,
          }
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
      await this.authAccountService.readStoreProfileMetadata(
        currentMembership.storeId,
      ),
    );
  }
}
