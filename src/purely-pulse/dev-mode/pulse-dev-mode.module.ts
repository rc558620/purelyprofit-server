import { Module } from '@nestjs/common';
import { PulseDevModeService } from './pulse-dev-mode.service';

@Module({
  providers: [PulseDevModeService],
  exports: [PulseDevModeService],
})
export class PulseDevModeModule {}
