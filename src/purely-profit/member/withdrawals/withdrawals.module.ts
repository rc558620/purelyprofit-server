import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import {
  PartnerPayoutController,
  WithdrawalsController,
} from './withdrawals.controller';
import { WithdrawalsSharedService } from './withdrawals-shared.service';
import { WithdrawalsService } from './withdrawals.service';

@Module({
  imports: [AuthModule],
  controllers: [WithdrawalsController, PartnerPayoutController],
  providers: [WithdrawalsService, WithdrawalsSharedService],
  exports: [WithdrawalsService],
})
export class WithdrawalsModule {}
