import { Module } from '@nestjs/common';
import { PulseDevModeAccessService } from './pulse-dev-mode-access.service';
import { PulseDevModeDashboardService } from './pulse-dev-mode-dashboard.service';
import { PulseDevModeGrowthService } from './pulse-dev-mode-growth.service';
import { PulseDevModeMembershipService } from './pulse-dev-mode-membership.service';
import { PulseDevModeSessionService } from './pulse-dev-mode-session.service';
import { PulseDevModeService } from './pulse-dev-mode.service';

@Module({
  providers: [
    PulseDevModeAccessService,
    PulseDevModeSessionService,
    PulseDevModeDashboardService,
    PulseDevModeMembershipService,
    PulseDevModeGrowthService,
    PulseDevModeService,
  ],
  exports: [PulseDevModeService, PulseDevModeAccessService],
})
export class PulseDevModeModule {}
