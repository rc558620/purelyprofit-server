import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildMarketingPaginationMeta,
  resolveMarketingPagination,
} from '../marketing.utils';
import { SmsAccountService } from './sms-account.service';
import type {
  SmsRechargeTiersResponseDto,
  SmsWalletLogsQueryDto,
  SmsWalletLogsResponseDto,
  SmsWalletResponseDto,
} from './dto/sms.dto';
import { toSmsWalletLogItem } from './sms.mapper';

/** 短信钱包：概览 / 充值档位 / 流水列表 */
@Injectable()
export class SmsWalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accountService: SmsAccountService,
  ) {}

  async getWallet(storeId: number): Promise<SmsWalletResponseDto> {
    const account = await this.accountService.getAccount(storeId);

    return {
      balanceFen: account.balanceFen,
      unitPriceFen: this.accountService.resolveUnitPriceFen(),
      warningThresholdFen: this.accountService.resolveWarningThresholdFen(),
      totalRechargedFen: account.totalRechargedFen,
      totalConsumedFen: account.totalConsumedFen,
      sentSmsCount: account.sentSmsCount,
    };
  }

  getRechargeTiers(): SmsRechargeTiersResponseDto {
    return { tiers: this.accountService.resolveRechargeTiers() };
  }

  async listWalletLogs(
    storeId: number,
    query: SmsWalletLogsQueryDto,
  ): Promise<SmsWalletLogsResponseDto> {
    const { page, skip, take } = resolveMarketingPagination(
      query.page,
      query.pageSize,
    );

    const [rows, total] = await Promise.all([
      this.prisma.smsWalletLog.findMany({
        where: { storeId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
        select: {
          id: true,
          type: true,
          changeFen: true,
          balanceAfterFen: true,
          description: true,
          createdAt: true,
        },
      }),
      this.prisma.smsWalletLog.count({ where: { storeId } }),
    ]);

    return {
      items: rows.map(toSmsWalletLogItem),
      meta: buildMarketingPaginationMeta(total, page, take),
    };
  }
}
