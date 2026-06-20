import { Module } from '@nestjs/common';
import { PulseDevModeModule } from '../dev-mode/pulse-dev-mode.module';
import { PulseStoreContextModule } from '../pulse-store-context.module';
import { RedisModule } from '../../redis/redis.module';
import { OnboardingController } from './onboarding.controller';
import { OnboardingStatusService } from './onboarding-status.service';
import { OnboardingService } from './onboarding.service';

@Module({
  imports: [RedisModule, PulseStoreContextModule, PulseDevModeModule],
  controllers: [OnboardingController],
  providers: [OnboardingStatusService, OnboardingService],
  exports: [OnboardingService],
})
export class PulseOnboardingModule {}
