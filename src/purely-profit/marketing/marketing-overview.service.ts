import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import {
  buildCacheRefreshTaskKey,
  buildMarketingOverviewCacheKey,
} from '../../redis/keys';
import { RefreshableCacheService } from '../../redis/refreshable-cache.service';
import {
  buildStoreInviteQrImageDataUrl,
  buildStoreInviteQrPayload,
  STORE_INVITE_QR_PROTOCOL_LEGACY,
  STORE_INVITE_QR_PROTOCOL_V1,
} from '../stores/store-invite-code-qr.utils';
import { Money } from '../../shared/money.utils';
import {
  getShanghaiDayStartMs,
  getShanghaiMonthStartMs,
  getShanghaiYear,
  makeShanghaiMs,
} from '../../shared/shanghai-time.utils';
import type {
  UpdateMarketingMemberLevelDto,
  UpdateMarketingPointsRatioDto,
} from './dto/marketing-query.dto';
import type {
  MarketingMemberLevelDto,
  MarketingMemberLevelSettingsDto,
  MarketingOverviewDto,
  MarketingPointsRatioDto,
} from './dto/marketing-response.dto';
import {
  buildEmptyMarketingOverview,
  buildOverviewLast30Days,
  buildOverviewMonthlyTrend,
} from './marketing.mapper';
import { MarketingMemberLevelSettingsService } from './marketing-member-level-settings.service';
import {
  queryOverviewDailyTrend,
  queryOverviewMonthlyTrend,
} from './marketing-overview.query';
import { MarketingSharedService } from './marketing-shared.service';

const MARKETING_OVERVIEW_CACHE_TTL_SECONDS = 120;
const MARKETING_OVERVIEW_REFRESH_AFTER_MS = 30_000;

type MarketingOverviewWechatPayRecord = {
  mchId: string | null;
  mchName: string | null;
  configuredAt: Date | null;
};

type StoreActiveInviteCodeRecord = {
  code: string;
} | null;

@Injectable()
export class MarketingOverviewService {
  private readonly logger = new Logger(MarketingOverviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly refreshableCache: RefreshableCacheService,
    private readonly marketingSharedService: MarketingSharedService,
    private readonly memberLevelSettingsService: MarketingMemberLevelSettingsService,
    private readonly configService: ConfigService,
  ) {}

  async getOverview(
    user: AuthenticatedUser,
    storeId?: number,
  ): Promise<MarketingOverviewDto> {
    const resolvedStoreId =
      await this.marketingSharedService.resolveMembershipManagedStoreId(
        user,
        storeId,
      );
    if (!resolvedStoreId) {
      return buildEmptyMarketingOverview();
    }

    const cacheKey = buildMarketingOverviewCacheKey(resolvedStoreId);
    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: MARKETING_OVERVIEW_CACHE_TTL_SECONDS,
      refreshAfterMs: MARKETING_OVERVIEW_REFRESH_AFTER_MS,
      loadValue: () => this.buildOverview(resolvedStoreId),
    });
  }

  getMemberLevelSettings(
    user: AuthenticatedUser,
    storeId?: number,
  ): Promise<MarketingMemberLevelSettingsDto> {
    return this.memberLevelSettingsService.getMemberLevelSettings(
      user,
      storeId,
    );
  }

  updateMemberLevel(
    user: AuthenticatedUser,
    levelId: string,
    dto: UpdateMarketingMemberLevelDto,
    storeId?: number,
  ): Promise<MarketingMemberLevelDto> {
    return this.memberLevelSettingsService.updateMemberLevel(
      user,
      levelId,
      dto,
      storeId,
    );
  }

  updatePointsRatio(
    user: AuthenticatedUser,
    dto: UpdateMarketingPointsRatioDto,
    storeId?: number,
  ): Promise<MarketingPointsRatioDto> {
    return this.memberLevelSettingsService.updatePointsRatio(
      user,
      dto,
      storeId,
    );
  }

  async warmOverviewCache(storeId: number): Promise<MarketingOverviewDto> {
    const cacheKey = buildMarketingOverviewCacheKey(storeId);
    const data = await this.buildOverview(storeId);
    await this.refreshableCache.writeRefreshableJson(
      cacheKey,
      data,
      MARKETING_OVERVIEW_CACHE_TTL_SECONDS,
      MARKETING_OVERVIEW_REFRESH_AFTER_MS,
    );
    return data;
  }

  private async buildOverview(storeId: number): Promise<MarketingOverviewDto> {
    const now = new Date();
    const nowMs = now.getTime();
    const todayStart = new Date(getShanghaiDayStartMs(nowMs));
    const monthStart = new Date(getShanghaiMonthStartMs(nowMs));
    const previousYearStart = new Date(
      makeShanghaiMs(getShanghaiYear(nowMs) - 1, 0, 1),
    );

    const [
      activeMemberCount,
      balanceSum,
      totalRechargeAgg,
      todayRechargeAgg,
      thisMonthRechargeAgg,
      rechargeCount,
      dailyTotals,
      monthlyTotals,
      storeRecord,
      activeInviteCodeRecord,
    ] = await Promise.all([
      // F9: 活跃会员数以 marketing_consumptions 实时聚合为准（COUNT(DISTINCT customer_id)）
      // 餐饮扫码点餐等路径不更新 visitCount 物化字段，若仍按 visitCount > 0 会漏统计
      this.countActiveMembersFromConsumptions(storeId),
      this.prisma.marketingCustomer.aggregate({
        where: { storeId, deletedAt: null },
        _sum: { balance: true },
      }),
      this.prisma.marketingRecharge.aggregate({
        where: {
          storeId,
          type: { in: ['recharge', 'gift'] },
        },
        _sum: { totalAmount: true },
      }),
      this.prisma.marketingRecharge.aggregate({
        where: {
          storeId,
          createdAt: { gte: todayStart },
          type: { in: ['recharge', 'gift'] },
        },
        _sum: { totalAmount: true },
      }),
      this.prisma.marketingRecharge.aggregate({
        where: {
          storeId,
          createdAt: { gte: monthStart },
          type: { in: ['recharge', 'gift'] },
        },
        _sum: { totalAmount: true },
      }),
      this.prisma.marketingRecharge.count({
        where: { storeId, type: { in: ['recharge', 'gift'] } },
      }),
      queryOverviewDailyTrend(this.prisma, storeId),
      queryOverviewMonthlyTrend(this.prisma, storeId, previousYearStart),
      this.findStoreWechatPayConfig(storeId),
      this.findStoreActiveInviteCode(storeId),
    ]);

    const totalRecharge = Money.fromDbCents(
      totalRechargeAgg._sum.totalAmount ?? 0,
    ).toOutputYuan();
    const todayRecharge = Money.fromDbCents(
      todayRechargeAgg._sum.totalAmount ?? 0,
    ).toOutputYuan();
    const thisMonthRecharge = Money.fromDbCents(
      thisMonthRechargeAgg._sum.totalAmount ?? 0,
    ).toOutputYuan();
    const currentYear = getShanghaiYear(nowMs);
    const inviteCode = activeInviteCodeRecord?.code ?? null;

    const wechatConfigured = !!(
      storeRecord?.mchId && storeRecord?.configuredAt
    );

    // 本地生成二维码载荷与图片：配置了公共域名时产出 v1 稳定 URL，否则回退 legacy 裸码
    const inviteCodeQrPayload = inviteCode
      ? buildStoreInviteQrPayload(inviteCode, {
          baseUrl: this.configService.get<string>('club.publicBaseUrl'),
          entryPath: this.configService.get<string>('club.storeInviteQrEntryPath'),
        })
      : null;
    const isInviteCodeV1Url =
      inviteCodeQrPayload !== null && inviteCodeQrPayload !== inviteCode;
    const inviteCodeQrCodeImageUrl = inviteCodeQrPayload
      ? await buildStoreInviteQrImageDataUrl(inviteCodeQrPayload)
      : null;

    return {
      totalBalance: Money.fromDbCents(
        balanceSum._sum.balance ?? 0,
      ).toOutputYuan(),
      totalRecharge,
      todayRecharge,
      thisMonthRecharge,
      rechargeCount,
      activeMemberCount,
      inviteCode,
      inviteCodeQrCodeImageUrl,
      inviteQrPayloadVersion: inviteCode
        ? isInviteCodeV1Url
          ? STORE_INVITE_QR_PROTOCOL_V1
          : STORE_INVITE_QR_PROTOCOL_LEGACY
        : null,
      inviteQrEntryUrl: isInviteCodeV1Url ? inviteCodeQrPayload : null,
      last30Days: buildOverviewLast30Days(dailyTotals),
      currentYear,
      thisYearMonthlyTrend: buildOverviewMonthlyTrend(
        monthlyTotals,
        currentYear,
      ),
      lastYearMonthlyTrend: buildOverviewMonthlyTrend(
        monthlyTotals,
        currentYear - 1,
      ),
      wechatPayConfig: {
        configured: wechatConfigured,
        ...(storeRecord?.mchId ? { mchId: storeRecord.mchId } : {}),
        ...(storeRecord?.mchName ? { mchName: storeRecord.mchName } : {}),
        ...(storeRecord?.configuredAt
          ? { configuredAt: storeRecord.configuredAt.toISOString() }
          : {}),
      },
    };
  }

  /**
   * F9: 活跃会员数 = 在 marketing_consumptions 表中有消费记录的去重 customer 数。
   *
   * 不再依赖 marketing_customers.visitCount 物化字段——餐饮扫码点餐路径
   * （club-scan-ordering-checkout）只写消费记录、不更新 visitCount，按旧口径会漏统计。
   */
  private async countActiveMembersFromConsumptions(
    storeId: number,
  ): Promise<number> {
    const groups = await this.prisma.marketingConsumption.groupBy({
      by: ['customerId'],
      where: { storeId },
      _count: { _all: true },
    });
    return groups.length;
  }

  private async findStoreActiveInviteCode(
    storeId: number,
  ): Promise<StoreActiveInviteCodeRecord> {
    return this.prisma.storeInviteCode.findFirst({
      where: { storeId, isActive: true },
      select: { code: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * 从 StoreWechatPayConfig 表读取微信收款配置（Step 7: 0.5 敏感配置独立化）
   * 不再读取 Store 表的 @deprecated 字段，也不暴露 apiV3Key
   */
  private async findStoreWechatPayConfig(
    storeId: number,
  ): Promise<MarketingOverviewWechatPayRecord | null> {
    return await this.prisma.storeWechatPayConfig.findUnique({
      where: { storeId },
      select: {
        mchId: true,
        mchName: true,
        configuredAt: true,
      },
    });
  }
}
