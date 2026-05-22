import { Module } from '@nestjs/common';
import { PulseStoreContextModule } from '../pulse-store-context.module';
import { SessionController } from './session.controller';
import { SessionService } from './session.service';

@Module({
  imports: [PulseStoreContextModule],
  controllers: [SessionController],
  providers: [SessionService],
  exports: [SessionService],
})
export class PulseSessionModule {}
