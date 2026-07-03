import { Injectable } from '@nestjs/common';
import type { AccountIdentifiers } from './auth-account.types';
import { AuthAccountLookupService } from './auth-account-lookup.service';
import { AuthStaffActivationService } from './auth-staff-activation.service';

@Injectable()
export class AuthAccountService {
  constructor(
    private readonly authAccountLookupService: AuthAccountLookupService,
    private readonly authStaffActivationService: AuthStaffActivationService,
  ) {}

  async syncStaffMemberships(
    userId: number,
    identifiers: AccountIdentifiers,
  ): Promise<void> {
    await this.authAccountLookupService.syncStaffMemberships(
      userId,
      identifiers,
    );
    await this.authStaffActivationService.activateInvitedStaffMemberships(
      userId,
      identifiers,
    );
  }
}
