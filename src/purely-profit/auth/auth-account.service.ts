import { Injectable } from '@nestjs/common';
import type { AccountIdentifiers } from './auth-account.types';
import { AuthAccountLookupService } from './auth-account-lookup.service';
import { AuthAccountMembershipService } from './auth-account-membership.service';

@Injectable()
export class AuthAccountService {
  constructor(
    private readonly authAccountLookupService: AuthAccountLookupService,
    private readonly authAccountMembershipService: AuthAccountMembershipService,
  ) {}

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
