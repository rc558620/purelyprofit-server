import { Module } from '@nestjs/common';
import { CommerceModule } from '../commerce/commerce.module';
import { NotificationsBuildService } from './notifications-build.service';
import { NotificationsContextService } from './notifications-context.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsReadStateService } from './notifications-read-state.service';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [CommerceModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsBuildService,
    NotificationsContextService,
    NotificationsReadStateService,
    NotificationsService,
  ],
})
export class NotificationsModule {}
