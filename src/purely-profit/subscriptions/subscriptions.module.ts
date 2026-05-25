import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SubscriptionsAccessService } from './subscriptions-access.service';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsProfileService } from './subscriptions-profile.service';
import { SubscriptionsService } from './subscriptions.service';

@Module({
  imports: [AuthModule],
  controllers: [SubscriptionsController],
  providers: [
    SubscriptionsService,
    SubscriptionsAccessService,
    SubscriptionsProfileService,
  ],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
