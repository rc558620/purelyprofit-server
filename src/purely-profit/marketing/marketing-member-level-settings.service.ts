import { BadRequestException, Injectable, Logger } from '@nestjs/common';
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
  type MarketingMemberLevelConfigValue,
  type MarketingMemberLevelSettingsValue,
  type MarketingPointsRatioConfigValue,
} from './marketing.utils';
import {
  normalizeMemberLevelSettings,
  toMemberLevelDto,
  toPointsRatioDto,
} from './marketing-member-level-settings.mapper';
import { MarketingMemberLevelSettingsStoreService } from './marketing-member-level-settings.store.service';

@Injectable()
export class MarketingMemberLevelSettingsService {
  private readonly logger = new Logger(
    MarketingMemberLevelSettingsService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly marketingSharedService: MarketingSharedService,
    private readonly storeService: MarketingMemberLevelSettingsStoreService,
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
        levels: defaults.levels.map((l) => toMemberLevelDto(l)),
        pointsRatio: toPointsRatioDto(defaults.pointsRatio),
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
      this.storeService.resolvePointsFeatureEnabled(resolvedStoreId),
    ]);

    const settings = normalizeMemberLevelSettings(rawSettings);

    return {
      levels: settings.levels.map((l) => toMemberLevelDto(l)),
      pointsRatio: toPointsRatioDto({
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
    const settings = normalizeMemberLevelSettings(existing);
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

    await this.storeService.upsertMemberLevelSettings(
      resolvedStoreId,
      nextSettings,
    );

    const updated =
      nextSettings.levels.find((level) => level.id === levelId) ??
      nextSettings.levels[0];

    // 响应只暴露前端友好字段
    return toMemberLevelDto(updated);
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
    const settings = normalizeMemberLevelSettings(existing);

    // B-M5：有活跃积分活动时，强制启用，保持 GET 与存储一致性
    const pointsFeatureEnabled =
      await this.storeService.resolvePointsFeatureEnabled(resolvedStoreId);

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

    await this.storeService.upsertMemberLevelSettings(
      resolvedStoreId,
      nextSettings,
    );

    return toPointsRatioDto(nextSettings.pointsRatio);
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
}
