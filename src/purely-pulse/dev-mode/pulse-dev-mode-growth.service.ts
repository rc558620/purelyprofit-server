import { Injectable } from '@nestjs/common';
import type {
  PulseEarningsLogsResponseDto,
  PulseEarningsOverviewResponseDto,
  PulseWithdrawalAccountResponseDto,
} from '../growth/dto/pulse-growth.dto';

@Injectable()
export class PulseDevModeGrowthService {
  buildEarningsOverview(): PulseEarningsOverviewResponseDto {
    return {
      beanBalance: 0,
      totalEarnedBeans: 0,
      totalWithdrawnBeans: 0,
      totalPromos: 0,
      chargedPromos: 0,
      isPartner: false,
      pendingWithdrawals: 0,
    };
  }

  buildEarningsLogs(): PulseEarningsLogsResponseDto {
    return {
      items: [],
      beanBalance: 0,
    };
  }

  buildWithdrawalAccount(): PulseWithdrawalAccountResponseDto {
    return {
      isPartner: false,
      accountType: null,
      accountNo: null,
      accountName: null,
      beanBalance: 0,
    };
  }
}
