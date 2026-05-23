import { Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { PlatformMembershipModule } from '../member/platform-membership/platform-membership.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { MarketingAccessService } from './marketing-access.service';
import { MarketingController } from './marketing.controller';
import { MarketingService } from './marketing.service';

@Module({
  imports: [PrismaModule, AccessControlModule, PlatformMembershipModule],
  controllers: [MarketingController],
  providers: [MarketingService, MarketingAccessService],
})
export class MarketingModule {}
