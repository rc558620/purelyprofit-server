import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import type { ApplyWithdrawalResponseDto } from '../../purely-profit/member/withdrawals/dto/withdrawal-response.dto';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  PulseEarningsLogTypeValue,
  PulseEarningsLogsResponseDto,
  PulseEarningsOverviewResponseDto,
  PulseWithdrawalAccountResponseDto,
  UpdatePulseWithdrawalAccountDto,
} from './dto/pulse-growth.dto';
import { PulseGrowthAccessService } from './growth-access.service';
import {
  buildEarningsLogsResponse,
  buildEarningsOverviewResponse,
  buildWithdrawalAccountResponse,
} from './growth-earnings.domain';
import {
  queryEarningsOverviewData,
  queryPartnerBeanLogs,
  queryWithdrawalAccountPartners,
} from './growth-earnings.query';

@Injectable()
export class PulseGrowthEarningsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: PulseGrowthAccessService,
  ) {}

  async getEarningsOverview(
    user: AuthenticatedUser,
  ): Promise<PulseEarningsOverviewResponseDto> {
    const store = await this.accessService.resolveTargetStoreForGrowth(user);
    const overviewData = await queryEarningsOverviewData(this.prisma, store.id);

    return buildEarningsOverviewResponse(overviewData);
  }

  async getEarningsLogs(
    user: AuthenticatedUser,
    typeFilter: PulseEarningsLogTypeValue = 'all',
  ): Promise<PulseEarningsLogsResponseDto> {
    const store = await this.accessService.resolveTargetStoreForGrowth(user);
    const overviewData = await queryEarningsOverviewData(this.prisma, store.id);
    const logs = await queryPartnerBeanLogs(this.prisma, store.id);

    return buildEarningsLogsResponse({
      partners: overviewData.partners,
      logs,
      ownerName: store.ownerName,
      typeFilter,
    });
  }

  async getWithdrawalAccount(
    user: AuthenticatedUser,
  ): Promise<PulseWithdrawalAccountResponseDto> {
    const store = await this.accessService.resolveTargetStoreForGrowth(user);
    const partners = await queryWithdrawalAccountPartners(this.prisma, store.id);

    return buildWithdrawalAccountResponse(partners);
  }

  async updateWithdrawalAccount(
    user: AuthenticatedUser,
    _dto: UpdatePulseWithdrawalAccountDto,
  ): Promise<PulseWithdrawalAccountResponseDto> {
    await this.accessService.resolveTargetStoreForGrowth(user, {
      notFoundMessage: '当前未选中目标商家门店，暂无法操作提现账户',
    });
    throw new ForbiddenException(
      'Pulse 当前按开发者观察态运行，暂不支持代目标商家修改提现账户',
    );
  }

  async applyWithdrawal(
    user: AuthenticatedUser,
    _beanAmount: number,
  ): Promise<ApplyWithdrawalResponseDto> {
    await this.accessService.resolveTargetStoreForGrowth(user, {
      notFoundMessage: '当前未选中目标商家门店，暂无法发起提现申请',
    });
    throw new ForbiddenException(
      'Pulse 当前按开发者观察态运行，暂不支持代目标商家发起提现申请',
    );
  }
}
