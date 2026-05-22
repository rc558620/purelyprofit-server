import { Module } from '@nestjs/common';
import { PulseStoreContextModule } from '../pulse-store-context.module';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

@Module({
  imports: [PulseStoreContextModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
  exports: [OnboardingService],
})
export class PulseOnboardingModule {}
