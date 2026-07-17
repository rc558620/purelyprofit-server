import { Module } from '@nestjs/common';
import { AuthModule } from '../../purely-profit/auth/auth.module';
import { PlatformMembershipModule } from '../../purely-profit/member/platform-membership/platform-membership.module';
import { PulseStoreContextModule } from '../pulse-store-context.module';
import { PulseMembershipAccessService } from './membership-access.service';
import { PulseMembershipAdminBeansMutationService } from './membership-admin-beans-mutation.service';
import { PulseMembershipAdminMemberReadService } from './membership-admin-member-read.service';
import { PulseMembershipAdminMembershipMutationService } from './membership-admin-membership-mutation.service';
import { PulseMembershipAdminMutationStateService } from './membership-admin-mutation-state.service';
import { PulseMembershipAdminMutationService } from './membership-admin-mutation.service';
import { PulseMembershipAdminPointsMutationService } from './membership-admin-points-mutation.service';
import { PulseMembershipAdminSubAccountMutationService } from './membership-admin-sub-account-mutation.service';
import { PulseMembershipAdminSubAccountReadService } from './membership-admin-sub-account-read.service';
import { PulseMembershipAdminClubStatsService } from './membership-admin-club-stats.service';
import { PulseMembershipAdminLogsQueryService } from './membership-admin-logs-query.service';
import { PulseMembershipAdminQueryService } from './membership-admin-query.service';
import { PulseMembershipAdminSalesStatsService } from './membership-admin-sales-stats.service';
import { PulseMembershipAdminController } from './membership-admin.controller';
import { PulseMembershipAdminService } from './membership-admin.service';
import { PulseMembershipController } from './membership.controller';
import { PulseMembershipLedgerService } from './membership-ledger.service';
import { PulseMembershipOrdersService } from './membership-orders.service';
import { PulseMembershipService } from './membership.service';

@Module({
  imports: [AuthModule, PlatformMembershipModule, PulseStoreContextModule],
  controllers: [PulseMembershipController, PulseMembershipAdminController],
  providers: [
    PulseMembershipService,
    PulseMembershipAccessService,
    PulseMembershipLedgerService,
    PulseMembershipOrdersService,
    PulseMembershipAdminMemberReadService,
    PulseMembershipAdminSubAccountReadService,
    PulseMembershipAdminQueryService,
    PulseMembershipAdminClubStatsService,
    PulseMembershipAdminSalesStatsService,
    PulseMembershipAdminLogsQueryService,
    PulseMembershipAdminMutationStateService,
    PulseMembershipAdminMembershipMutationService,
    PulseMembershipAdminPointsMutationService,
    PulseMembershipAdminBeansMutationService,
    PulseMembershipAdminSubAccountMutationService,
    PulseMembershipAdminMutationService,
    PulseMembershipAdminService,
  ],
})
export class PulseMembershipModule {}
