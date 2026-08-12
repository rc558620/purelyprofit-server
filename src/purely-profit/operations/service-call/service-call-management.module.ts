import { Module } from '@nestjs/common';
import { ClubServiceCallModule } from '../../../purely-club/service-call/club-service-call.module';
import { CommerceModule } from '../../commerce/commerce.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ServiceCallManagementController } from './service-call-management.controller';
import { ServiceCallManagementService } from './service-call-management.service';
import { ServiceCallVoiceSettingsService } from './service-call-voice-settings.service';

@Module({
  imports: [PrismaModule, CommerceModule, ClubServiceCallModule],
  controllers: [ServiceCallManagementController],
  providers: [ServiceCallManagementService, ServiceCallVoiceSettingsService],
})
export class ServiceCallManagementModule {}
