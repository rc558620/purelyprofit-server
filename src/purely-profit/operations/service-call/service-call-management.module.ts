import { Module } from '@nestjs/common';
import { ClubServiceCallModule } from '../../../purely-club/service-call/club-service-call.module';
import { CommerceModule } from '../../commerce/commerce.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ServiceCallManagementController } from './service-call-management.controller';
import { ServiceCallManagementService } from './service-call-management.service';

@Module({
  imports: [PrismaModule, CommerceModule, ClubServiceCallModule],
  controllers: [ServiceCallManagementController],
  providers: [ServiceCallManagementService],
})
export class ServiceCallManagementModule {}
