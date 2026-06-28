import { Module } from '@nestjs/common';
import { CommerceModule } from '../../commerce/commerce.module';
import { PlatformMembershipModule } from '../../member/platform-membership/platform-membership.module';
import { ProfitDetailController } from './profit-detail.controller';
import { ProfitDetailService } from './profit-detail.service';

@Module({
  imports: [CommerceModule, PlatformMembershipModule],
  controllers: [ProfitDetailController],
  providers: [ProfitDetailService],
  exports: [ProfitDetailService],
})
export class ProfitDetailModule {}
