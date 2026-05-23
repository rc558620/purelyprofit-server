import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformMembershipModule } from '../member/platform-membership/platform-membership.module';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';

@Module({
  imports: [AuthModule, PlatformMembershipModule],
  controllers: [FinanceController],
  providers: [FinanceService],
})
export class FinanceModule {}
