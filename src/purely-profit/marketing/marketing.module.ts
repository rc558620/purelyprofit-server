import { Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { MarketingAccessService } from './marketing-access.service';
import { MarketingController } from './marketing.controller';
import { MarketingService } from './marketing.service';

@Module({
  imports: [PrismaModule, AccessControlModule],
  controllers: [MarketingController],
  providers: [MarketingService, MarketingAccessService],
})
export class MarketingModule {}
