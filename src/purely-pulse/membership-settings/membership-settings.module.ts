import { Module } from '@nestjs/common';
import { AuthModule } from '../../purely-profit/auth/auth.module';
import { PulseMembershipSettingsController } from './membership-settings.controller';
import { PulseMembershipSettingsService } from './membership-settings.service';

@Module({
  imports: [AuthModule],
  controllers: [PulseMembershipSettingsController],
  providers: [PulseMembershipSettingsService],
})
export class PulseMembershipSettingsModule {}
