import { Module } from '@nestjs/common';
import { AuthModule } from '../../purely-profit/auth/auth.module';
import { PulseMembershipSettingsAccessService } from './membership-settings-access.service';
import { PulseMembershipSettingsController } from './membership-settings.controller';
import { PulseMembershipSettingsProfileService } from './membership-settings-profile.service';
import { PulseMembershipSettingsService } from './membership-settings.service';

@Module({
  imports: [AuthModule],
  controllers: [PulseMembershipSettingsController],
  providers: [
    PulseMembershipSettingsService,
    PulseMembershipSettingsAccessService,
    PulseMembershipSettingsProfileService,
  ],
})
export class PulseMembershipSettingsModule {}
