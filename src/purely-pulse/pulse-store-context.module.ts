import { Module } from '@nestjs/common';
import { PulseStoreContextService } from './pulse-store-context.service';

@Module({
  providers: [PulseStoreContextService],
  exports: [PulseStoreContextService],
})
export class PulseStoreContextModule {}
