import { Module } from '@nestjs/common';
import { AuthModule } from '../../purely-profit/auth/auth.module';
import { PlatformMembershipModule } from '../../purely-profit/member/platform-membership/platform-membership.module';
import { PulseStoreContextModule } from '../pulse-store-context.module';
import { PulseMembershipAccessService } from './membership-access.service';
import { PulseMembershipAdminMutationService } from './membership-admin-mutation.service';
import { PulseMembershipAdminQueryService } from './membership-admin-query.service';
import { PulseMembershipAdminService } from './membership-admin.service';
import { PulseMembershipController } from './membership.controller';
import { PulseMembershipLedgerService } from './membership-ledger.service';
import { PulseMembershipOrdersService } from './membership-orders.service';
import { PulseMembershipService } from './membership.service';

@Module({
  imports: [AuthModule, PlatformMembershipModule, PulseStoreContextModule],
  controllers: [PulseMembershipController],
  providers: [
    PulseMembershipService,
    PulseMembershipAccessService,
    PulseMembershipLedgerService,
    PulseMembershipOrdersService,
    PulseMembershipAdminQueryService,
    PulseMembershipAdminMutationService,
    PulseMembershipAdminService,
  ],
})
export class PulseMembershipModule {}
