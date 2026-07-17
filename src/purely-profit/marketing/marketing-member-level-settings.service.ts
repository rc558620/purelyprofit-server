import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  UpdateMarketingMemberLevelDto,
  UpdateMarketingPointsRatioDto,
} from './dto/marketing-query.dto';
import type {
  MarketingMemberLevelDto,
  MarketingMemberLevelSettingsDto,
  MarketingPointsRatioDto,
} from './dto/marketing-response.dto';
import { MarketingSharedService } from './marketing-shared.service';
import {
  cloneDefaultMarketingMemberLevelSettings,
  getReadOnlyDefaultMarketingMemberLevelSettings,
  type MarketingMemberLevelConfigValue,
  type MarketingMemberLevelSettingsValue,
  type MarketingPointsRatioConfigValue,
} from './marketing.utils';
import {
  safeParseLevels,
  safeParsePointsRatio,
  strictParseLevels,
  strictParsePointsRatio,
} from './schemas/member-level-settings.schema';

type MarketingMemberLevelSettingRecord = {
  levels: Prisma.JsonValue;
  pointsRatio: Prisma.JsonValue;
};

@Injectable()
export class MarketingMemberLevelSettingsService {
  private readonly logger = new Logger(
    MarketingMemberLevelSettingsService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly marketingSharedService: MarketingSharedService,
  ) {}

  async getMemberLevelSettings(
    user: AuthenticatedUser,
    storeId?: number,
  ): Promise<MarketingMemberLevelSettingsDto> {
    const resolvedStoreId =
      await this.marketingSharedService.resolveMembershipManagedStoreId(
        user,
        storeId,
      );
    if (!resolvedStoreId) {
      const defaults = cloneDefaultMarketingMemberLevelSettings();
      return {
        levels: defaults.levels.map((l) => this.toMemberLevelDto(l)),
        pointsRatio: this.toPointsRatioDto(defaults.pointsRatio),
        pointsFeatureEnabled: false,
      };
    }

    const [rawSettings, pointsFeatureEnabled] = await Promise.all([
      this.prisma.marketingMemberLevelSetting.findUnique({
        where: { storeId: resolvedStoreId },
        select: {
          levels: true,
          pointsRatio: true,
        },
      }),
      this.resolvePointsFeatureEnabled(resolvedStoreId),
    ]);

    const settings = this.normalizeMemberLevelSettings(rawSettings);

    return {
      levels: settings.levels.map((l) => this.toMemberLevelDto(l)),
      pointsRatio: this.toPointsRatioDto({
        ...settings.pointsRatio,
        // 有活跃积分活动时，强制积分规则状态为启用，消除上下状态不一致
        enabled: pointsFeatureEnabled || settings.pointsRatio.enabled,
      }),
      pointsFeatureEnabled,
    };
  }

  async updateMemberLevel(
    user: AuthenticatedUser,
    levelId: string,
    dto: UpdateMarketingMemberLevelDto,
    storeId?: number,
  ): Promise<MarketingMemberLevelDto> {
    const resolvedStoreId = await this.resolveManageStoreId(user, storeId);
    const existing = await this.prisma.marketingMemberLevelSetting.findUnique({
      where: { storeId: resolvedStoreId },
      select: {
        levels: true,
        pointsRatio: true,
      },
    });
    const settings = this.normalizeMemberLevelSettings(existing);
    const now = Date.now();

    // B7：非 gold 等级不允许 spendThreshold=0，门槛必须有意义
    if (
      dto.spendThreshold !== undefined &&
      levelId !== 'gold' &&
      dto.spendThreshold <= 0
    ) {
      throw new BadRequestException('升级消费门槛必须大于 0');
    }

    const levels = settings.levels.map((level) => {
      if (level.id !== levelId) {
        return level;
      }

      // 后端做 pct→rate 归一化，前端不参与换算
      const discountRate =
        dto.discountRatePct !== undefined
          ? Math.round(dto.discountRatePct) / 100
          : level.discountRate;
      const discountRatePct = Math.round(discountRate * 100);

      return {
        ...level,
        discountRate,
        discountRatePct,
        ...(dto.spendThreshold !== undefined && level.id !== 'gold'
          ? { spendThreshold: dto.spendThreshold }
          : {}),
        ...(dto.description !== undefined
          ? { description: dto.description.trim() }
          : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(level.id === 'gold' ? { spendThreshold: 0 } : {}),
        updatedAt: now,
      } satisfies MarketingMemberLevelConfigValue;
    });

    // B-M4：等级门槛单调递增校验（gold=0 ≤ platinum < diamond）
    const platinumThreshold =
      levels.find((l) => l.id === 'platinum')?.spendThreshold ?? 0;
    const diamondThreshold =
      levels.find((l) => l.id === 'diamond')?.spendThreshold ?? 0;
    if (
      platinumThreshold > 0 &&
      diamondThreshold > 0 &&
      platinumThreshold >= diamondThreshold
    ) {
      throw new BadRequestException(
        `铂金门槛(${platinumThreshold})必须小于钻石门槛(${diamondThreshold})`,
      );
    }

    const nextSettings = {
      ...settings,
      levels,
    } satisfies MarketingMemberLevelSettingsValue;

    await this.upsertMemberLevelSettings(resolvedStoreId, nextSettings);

    const updated =
      nextSettings.levels.find((level) => level.id === levelId) ??
      nextSettings.levels[0];

    // 响应只暴露前端友好字段
    return this.toMemberLevelDto(updated);
  }

  async updatePointsRatio(
    user: AuthenticatedUser,
    dto: UpdateMarketingPointsRatioDto,
    storeId?: number,
  ): Promise<MarketingPointsRatioDto> {
    const resolvedStoreId = await this.resolveManageStoreId(user, storeId);
    const existing = await this.prisma.marketingMemberLevelSetting.findUnique({
      where: { storeId: resolvedStoreId },
      select: {
        levels: true,
        pointsRatio: true,
      },
    });
    const settings = this.normalizeMemberLevelSettings(existing);

    // B-M5：有活跃积分活动时，强制启用，保持 GET 与存储一致性
    const pointsFeatureEnabled =
      await this.resolvePointsFeatureEnabled(resolvedStoreId);

    // 后端做 pct→rate、yuan→cents 归一化，前端不参与换算
    const earnRatioYuan =
      dto.earnRatioYuan !== undefined
        ? dto.earnRatioYuan
        : settings.pointsRatio.earnRatioYuan;
    const earnRatioCents = earnRatioYuan; // 存储字段：值与 earnRatioYuan 相同（单位均为元）

    const maxRedeemPct =
      dto.maxRedeemPct !== undefined
        ? Math.round(dto.maxRedeemPct)
        : settings.pointsRatio.maxRedeemPct;
    const maxRedeemRatio = maxRedeemPct / 100;

    const nextSettings = {
      ...settings,
      pointsRatio: {
        ...settings.pointsRatio,
        earnRatioCents,
        earnRatioYuan,
        ...(dto.redeemRatioPoints !== undefined
          ? { redeemRatioPoints: dto.redeemRatioPoints }
          : {}),
        maxRedeemRatio,
        maxRedeemPct,
        // B-M5：有活跃活动时强制启用，保持 GET 与存储一致性
        ...(dto.enabled !== undefined
          ? { enabled: dto.enabled || pointsFeatureEnabled }
          : pointsFeatureEnabled
            ? { enabled: true }
            : {}),
        updatedAt: Date.now(),
      } satisfies MarketingPointsRatioConfigValue,
    } satisfies MarketingMemberLevelSettingsValue;

    await this.upsertMemberLevelSettings(resolvedStoreId, nextSettings);

    return this.toPointsRatioDto(nextSettings.pointsRatio);
  }

  private async resolveManageStoreId(
    user: AuthenticatedUser,
    storeId?: number,
  ): Promise<number> {
    const resolvedStoreId =
      await this.marketingSharedService.resolveMembershipManagedStoreId(
        user,
        storeId,
      );
    if (!resolvedStoreId) {
      throw new BadRequestException('当前账号未绑定可管理门店');
    }

    await this.marketingSharedService.ensureMarketingStoreAccess(
      user,
      resolvedStoreId,
      'marketing:manage',
    );

    return resolvedStoreId;
  }

  private async resolvePointsFeatureEnabled(storeId: number): Promise<boolean> {
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

  private normalizeMemberLevelSettings(
    settings: MarketingMemberLevelSettingRecord | null,
  ): MarketingMemberLevelSettingsValue {
    const fallback = getReadOnlyDefaultMarketingMemberLevelSettings();
    if (!settings) {
      return { ...fallback };
    }

    // 使用 Zod schema 解析 levels
    const parsedLevels = safeParseLevels(settings.levels);

    // 将 Zod 解析结果与默认值按 id 合并（保持默认值兜底）
    return {
      levels: fallback.levels.map((defaultLevel) => {
        const matched = parsedLevels.find(
          (item) => item.id === defaultLevel.id,
        );
        return matched
          ? {
              ...defaultLevel,
              ...matched,
              id: defaultLevel.id,
              // 兼容旧数据：若 DB 无 discountRatePct，则从 discountRate 推导
              discountRatePct:
                matched.discountRatePct ??
                Math.round(
                  (matched.discountRate ?? defaultLevel.discountRate) * 100,
                ),
            }
          : { ...defaultLevel };
      }),
      pointsRatio: this.normalizePointsRatio(
        settings.pointsRatio,
        fallback.pointsRatio,
      ),
    };
  }

  private normalizePointsRatio(
    raw: Prisma.JsonValue,
    fallback: MarketingPointsRatioConfigValue,
  ): MarketingPointsRatioConfigValue {
    // 优先使用 Zod schema 解析
    const parsed = safeParsePointsRatio(raw);
    if (parsed) {
      return {
        earnRatioCents: parsed.earnRatioCents,
        earnRatioYuan: parsed.earnRatioYuan ?? parsed.earnRatioCents,
        redeemRatioPoints: parsed.redeemRatioPoints,
        maxRedeemRatio: parsed.maxRedeemRatio,
        maxRedeemPct:
          parsed.maxRedeemPct ?? Math.round(parsed.maxRedeemRatio * 100),
        enabled: parsed.enabled,
        updatedAt: parsed.updatedAt,
      };
    }

    // Zod 解析失败，回退到手写归一化
    const normalized =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? raw
        : ({} as Record<string, unknown>);

    const earnRatioCents =
      typeof normalized.earnRatioCents === 'number'
        ? Math.max(1, Math.round(normalized.earnRatioCents))
        : fallback.earnRatioCents;
    const maxRedeemRatio =
      typeof normalized.maxRedeemRatio === 'number'
        ? normalized.maxRedeemRatio
        : fallback.maxRedeemRatio;

    return {
      earnRatioCents,
      earnRatioYuan: earnRatioCents, // 单位一致，均为元
      redeemRatioPoints:
        typeof normalized.redeemRatioPoints === 'number'
          ? Math.max(1, Math.round(normalized.redeemRatioPoints))
          : fallback.redeemRatioPoints,
      maxRedeemRatio,
      maxRedeemPct: Math.round(maxRedeemRatio * 100),
      enabled:
        typeof normalized.enabled === 'boolean'
          ? normalized.enabled
          : fallback.enabled,
      updatedAt:
        typeof normalized.updatedAt === 'number'
          ? normalized.updatedAt
          : fallback.updatedAt,
    };
  }

  /** 将内部 level 值转为前端友好 DTO */
  private toMemberLevelDto(
    level: MarketingMemberLevelConfigValue,
  ): MarketingMemberLevelDto {
    return {
      id: level.id,
      name: level.name,
      discountRatePct: level.discountRatePct,
      spendThreshold: level.spendThreshold,
      description: level.description,
      enabled: level.enabled,
      updatedAt: level.updatedAt,
    };
  }

  /** 将内部 pointsRatio 值转为前端友好 DTO */
  private toPointsRatioDto(
    ratio: MarketingPointsRatioConfigValue,
  ): MarketingPointsRatioDto {
    return {
      earnRatioYuan: ratio.earnRatioYuan,
      redeemRatioPoints: ratio.redeemRatioPoints,
      maxRedeemPct: ratio.maxRedeemPct,
      enabled: ratio.enabled,
      updatedAt: ratio.updatedAt,
    };
  }

  private async upsertMemberLevelSettings(
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
