import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { MarketingMemberLevelSettingsValue } from './marketing.utils';
import {
  strictParseLevels,
  strictParsePointsRatio,
} from './schemas/member-level-settings.schema';

@Injectable()
export class MarketingMemberLevelSettingsStoreService {
  private readonly logger = new Logger(
    MarketingMemberLevelSettingsStoreService.name,
  );

  constructor(private readonly prisma: PrismaService) {}

  /** 是否有活跃的积分充值活动（有则强制启用积分规则） */
  async resolvePointsFeatureEnabled(storeId: number): Promise<boolean> {
    const now = new Date();
    const promotion = await this.prisma.marketingPromotion.findFirst({
      where: {
        storeId,
        type: 'points_recharge',
        enabled: true,
        startAt: { lte: now },
        endAt: { gte: now },
      },
      select: { params: true },
      orderBy: { updatedAt: 'desc' },
    });

    if (!promotion?.params || typeof promotion.params !== 'object') {
      return false;
    }

    const params = promotion.params as Record<string, unknown>;
    const rechargeRatioPercent =
      typeof params.rechargeRatioPercent === 'number'
        ? params.rechargeRatioPercent
        : typeof params.pointsRatio === 'number'
          ? params.pointsRatio
          : null;

    return rechargeRatioPercent !== null && rechargeRatioPercent > 0;
  }

  /** 写回设置：严格 Zod 校验 + advisory lock 并发保护 */
  async upsertMemberLevelSettings(
    storeId: number,
    settings: MarketingMemberLevelSettingsValue,
  ): Promise<void> {
    // B-M2：写回前严格 Zod 校验，阻止脏数据落库
    strictParseLevels(settings.levels);
    strictParsePointsRatio(settings.pointsRatio);

    // B-M3：并发保护 —— 事务内加 PostgreSQL advisory lock 序列化同门店写操作
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        `member_level_settings:${storeId}`,
      );
      await tx.marketingMemberLevelSetting.upsert({
        where: { storeId },
        create: {
          storeId,
          levels: settings.levels as unknown as Prisma.InputJsonValue,
          pointsRatio: settings.pointsRatio as unknown as Prisma.InputJsonValue,
        },
        update: {
          levels: settings.levels as unknown as Prisma.InputJsonValue,
          pointsRatio: settings.pointsRatio as unknown as Prisma.InputJsonValue,
        },
      });
    });
  }
}
