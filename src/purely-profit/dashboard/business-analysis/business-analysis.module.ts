import { Module } from '@nestjs/common';
import { CommerceModule } from '../../commerce/commerce.module';
import { PlatformMembershipModule } from '../../member/platform-membership/platform-membership.module';
import { BusinessAnalysisController } from './business-analysis.controller';
import { BusinessAnalysisService } from './business-analysis.service';

@Module({
  imports: [CommerceModule, PlatformMembershipModule],
  controllers: [BusinessAnalysisController],
  providers: [BusinessAnalysisService],
  exports: [BusinessAnalysisService],
})
export class BusinessAnalysisModule {}
