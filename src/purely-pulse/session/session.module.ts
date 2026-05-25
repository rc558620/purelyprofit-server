import { Module } from '@nestjs/common';
import { PulseStoreContextModule } from '../pulse-store-context.module';
import { SessionBootstrapService } from './session-bootstrap.service';
import { SessionController } from './session.controller';
import { SessionNotificationService } from './session-notification.service';
import { SessionService } from './session.service';
import { SessionStoreService } from './session-store.service';

@Module({
  imports: [PulseStoreContextModule],
  controllers: [SessionController],
  providers: [
    SessionBootstrapService,
    SessionNotificationService,
    SessionStoreService,
    SessionService,
  ],
  exports: [SessionService],
})
export class PulseSessionModule {}
