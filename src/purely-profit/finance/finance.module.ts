import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformMembershipModule } from '../member/platform-membership/platform-membership.module';
import { FinanceAccessService } from './finance-access.service';
import { FinanceAccountService } from './finance-account.service';
import { FinanceCashFlowService } from './finance-cash-flow.service';
import { FinanceController } from './finance.controller';
import { FinanceOverviewService } from './finance-overview.service';
import { FinanceReconciliationService } from './finance-reconciliation.service';
import { FinanceService } from './finance.service';

@Module({
  imports: [forwardRef(() => AuthModule), PlatformMembershipModule],
  controllers: [FinanceController],
  providers: [
    FinanceAccessService,
    FinanceOverviewService,
    FinanceCashFlowService,
    FinanceAccountService,
    FinanceReconciliationService,
    FinanceService,
  ],
  exports: [FinanceOverviewService],
})
export class FinanceModule {}
