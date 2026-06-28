import { Module } from '@nestjs/common';
import { CommerceModule } from '../../commerce/commerce.module';
import { PlatformMembershipModule } from '../../member/platform-membership/platform-membership.module';
import { CostsController } from './costs.controller';
import { CostsReadService } from './costs-read.service';
import { CostsService } from './costs.service';
import { CostsWriteService } from './costs-write.service';

@Module({
  imports: [CommerceModule, PlatformMembershipModule],
  controllers: [CostsController],
  providers: [CostsReadService, CostsWriteService, CostsService],
  exports: [CostsService, CostsReadService],
})
export class CostsModule {}
