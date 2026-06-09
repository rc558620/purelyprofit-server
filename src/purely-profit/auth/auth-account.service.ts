import { Injectable } from '@nestjs/common';
import type {
  AccountIdentifiers,
  AuthProductScope,
  PhoneUserRecord,
} from './auth-account.types';
import { AuthAccountLookupService } from './auth-account-lookup.service';
import { AuthAccountMembershipService } from './auth-account-membership.service';
import type {
  ProfileMembershipRecord,
  ProfileUserRecord,
} from './auth-profile.types';
import type { AuthenticatedUser } from './strategies/jwt.strategy';
import type { StoreProfileMetadata } from '../stores/dto/store-response.dto';

@Injectable()
export class AuthAccountService {
  constructor(
    private readonly authAccountLookupService: AuthAccountLookupService,
    private readonly authAccountMembershipService: AuthAccountMembershipService,
  ) {}

  async findUserByLoginAccount(
    account: string,
    productScope: AuthProductScope,
  ): Promise<PhoneUserRecord | null> {
    return this.authAccountLookupService.findUserByLoginAccount(
      account,
      productScope,
    );
  }

  async findUserByEmail(
    email: string,
    productScope: AuthProductScope,
  ): Promise<PhoneUserRecord | null> {
    return this.authAccountLookupService.findUserByEmail(email, productScope);
  }

  async findUserByPhone(
    phone: string,
    productScope: AuthProductScope,
  ): Promise<PhoneUserRecord | null> {
    return this.authAccountLookupService.findUserByPhone(phone, productScope);
  }

  async ensureUserNotBanned(userId: number): Promise<void> {
    await this.authAccountMembershipService.ensureUserNotBanned(userId);
  }

  async findProfileUserOrThrow(userId: number): Promise<ProfileUserRecord> {
    return this.authAccountLookupService.findProfileUserOrThrow(userId);
  }

  async findCurrentMembership(
    user: AuthenticatedUser,
  ): Promise<ProfileMembershipRecord | null> {
    return this.authAccountMembershipService.findCurrentMembership(user);
  }

  async updateAvatar(userId: number, avatar: string | null): Promise<void> {
    await this.authAccountLookupService.updateAvatar(userId, avatar);
  }

  async verifyRealName(
    userId: number,
    realName: string,
    idNumber: string,
  ): Promise<void> {
    await this.authAccountLookupService.verifyRealName(
      userId,
      realName,
      idNumber,
    );
  }

  async readStoreProfileMetadata(
    storeId: number,
  ): Promise<StoreProfileMetadata> {
    return this.authAccountMembershipService.readStoreProfileMetadata(storeId);
  }

  async syncStaffMemberships(
    userId: number,
    identifiers: AccountIdentifiers,
  ): Promise<void> {
    await this.authAccountLookupService.syncStaffMemberships(
      userId,
      identifiers,
    );
    await this.authAccountMembershipService.activateInvitedStaffMemberships(
      userId,
      identifiers,
    );
  }
}
