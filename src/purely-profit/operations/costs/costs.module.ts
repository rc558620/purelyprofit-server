import { Module } from '@nestjs/common';
import { CommerceModule } from '../../commerce/commerce.module';
import { PlatformMembershipModule } from '../../member/platform-membership/platform-membership.module';
import { CostsController } from './costs.controller';
import { CostsService } from './costs.service';

@Module({
  imports: [CommerceModule, PlatformMembershipModule],
  controllers: [CostsController],
  providers: [CostsService],
  exports: [CostsService],
})
export class CostsModule {}
