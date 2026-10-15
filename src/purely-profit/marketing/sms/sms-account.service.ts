import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  SMS_UNIT_PRICE_FEN_DEFAULT,
  SMS_WARNING_THRESHOLD_FEN_DEFAULT,
} from './sms.constants';
import type { SmsRechargeTierDto } from './dto/sms.dto';
import {
  formatFenAmountDisplay,
  resolveSmsRechargeTiersFen,
  resolveSmsUnitPriceFen,
  resolveSmsWarningThresholdFen,
} from './sms.utils';

export interface SmsAccountRow {
  id: number;
  storeId: number;
  balanceFen: number;
  totalRechargedFen: number;
  totalConsumedFen: number;
  sentSmsCount: number;
}

/**
 * 短信账户服务：只负责「账户行」的读写与运营口径配置解析。
 *
 * 所有金额走 Int 分；单价/阈值/档位一律从 configuration 的 sms 块读取，
 * 不信任前端传入的任何金额或单价。
 */
@Injectable()
export class SmsAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 事务内取账户（不存在则创建）。
   *
   * 用 upsert 而非「先查后建」：并发的首充回调与首次群发会同时查到 null
   * 并各自 create，后到者触发 P2002。upsert 由数据库保证原子性。
   */
  async ensureAccount(
    client: Prisma.TransactionClient | PrismaService,
    storeId: number,
  ): Promise<SmsAccountRow> {
    return client.storeSmsAccount.upsert({
      where: { storeId },
      create: { storeId },
      update: {},
      select: {
        id: true,
        storeId: true,
        balanceFen: true,
        totalRechargedFen: true,
        totalConsumedFen: true,
        sentSmsCount: true,
      },
    });
  }

  async getAccount(storeId: number): Promise<SmsAccountRow> {
    return this.ensureAccount(this.prisma, storeId);
  }

  resolveUnitPriceFen(): number {
    return resolveSmsUnitPriceFen(this.configService);
  }

  resolveWarningThresholdFen(): number {
    return resolveSmsWarningThresholdFen(this.configService);
  }

  /**
   * 充值档位。**不含任何赠送**：赠送由 purelyPulse 侧发放并计入 grant 流水，
   * 这里若加 bonus 字段会让前端误以为充值即送。
   */
  resolveRechargeTiers(): SmsRechargeTierDto[] {
    const tiers = resolveSmsRechargeTiersFen(this.configService);

    return tiers.map((amountFen) => ({
      amountFen,
      amountDisplay: formatFenAmountDisplay(amountFen),
    }));
  }

  /** 单条短信单价（分），未配置 env 时回落 {@link SMS_UNIT_PRICE_FEN_DEFAULT} */
  getDefaultUnitPriceFen(): number {
    return SMS_UNIT_PRICE_FEN_DEFAULT;
  }

  /** 余额告警阈值（分），未配置 env 时回落 {@link SMS_WARNING_THRESHOLD_FEN_DEFAULT} */
  getDefaultWarningThresholdFen(): number {
    return SMS_WARNING_THRESHOLD_FEN_DEFAULT;
  }
}
