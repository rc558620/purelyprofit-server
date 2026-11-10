import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CommerceAccessService } from '../../purely-profit/commerce/commerce-access.service';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { buildCacheRefreshTaskKey } from '../../redis/cache-keys';
import { RefreshableCacheService } from '../../redis/refreshable-cache.service';

/** 扫码点餐取餐相关门店配置。 */
export interface ScanOrderingPickupSettings {
  /** 语音播报开关（商家端控制，顾客端据此展示取餐通知弹窗）。 */
  pickupVoiceEnabled: boolean;
  /** 出餐自动打印开关（商家端控制，开启后点击出餐自动唤起小票打印）。 */
  serveAutoPrintEnabled: boolean;
  /** 新订单语音播报开关（商家端控制，收到顾客下单时播报「您有新的订单，请注意查收」）。 */
  orderNoticeVoiceEnabled: boolean;
  /** 新订单弹窗通知开关（商家端控制，收到顾客下单时弹出左下角通知卡片）。 */
  orderNoticeEnabled: boolean;
}

/**
 * 门店配置读缓存：顾客进店必调，原本每次请求都要读一次 stores 表。
 *
 * 复用 RefreshableCacheService 获得未命中并发去重（singleflight）、TTL 抖动
 * 与后台刷新；写路径采用写穿透立即覆盖，避免失效瞬间的并发回源。
 * 缓存只是加速层：Redis 异常时静默降级为查库，不改变接口可用性。
 */
const PICKUP_SETTINGS_CACHE_TTL_SECONDS = 30;
const PICKUP_SETTINGS_CACHE_REFRESH_AFTER_MS = 10_000;

function buildPickupSettingsCacheKey(storeId: number): string {
  return `scanordering:pickup-settings:store:${storeId}`;
}

/**
 * 扫码点餐取餐相关门店配置服务。
 *
 * 事实源为后端 stores.pickup_voice_enabled，purelyProfit 商家端读写，
 * purelyClub 顾客端只读；不允许 purelyClub 自行猜测商家开关状态。
 */
@Injectable()
export class ScanOrderingPickupSettingsService {
  private readonly logger = new Logger(ScanOrderingPickupSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly refreshableCache: RefreshableCacheService,
  ) {}

  /** 按门店 ID 读取配置（顾客端使用）。 */
  async getByStoreId(storeId: number): Promise<ScanOrderingPickupSettings> {
    const cacheKey = buildPickupSettingsCacheKey(storeId);
    try {
      return await this.refreshableCache.getOrLoadRefreshableJson<ScanOrderingPickupSettings>(
        {
          cacheKey,
          taskKey: buildCacheRefreshTaskKey(cacheKey),
          ttlSeconds: PICKUP_SETTINGS_CACHE_TTL_SECONDS,
          refreshAfterMs: PICKUP_SETTINGS_CACHE_REFRESH_AFTER_MS,
          loadValue: () => this.fetchByStoreId(storeId),
        },
      );
    } catch (error) {
      // 业务异常不能被缓存降级吞掉；其余异常按缓存不可用处理，回退查库
      if (error instanceof NotFoundException) throw error;
      this.logger.warn(
        `读取取餐配置缓存失败 storeId=${storeId}，回退查库: ${error instanceof Error ? error.message : String(error)}`,
      );
      return this.fetchByStoreId(storeId);
    }
  }

  /** 配置事实源：缓存回源与写穿透共用同一份字段口径。 */
  private async fetchByStoreId(
    storeId: number,
  ): Promise<ScanOrderingPickupSettings> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: {
        pickupVoiceEnabled: true,
        serveAutoPrintEnabled: true,
        orderNoticeVoiceEnabled: true,
        orderNoticeEnabled: true,
      },
    });
    if (!store) throw new NotFoundException('门店不存在');
    return {
      pickupVoiceEnabled: store.pickupVoiceEnabled,
      serveAutoPrintEnabled: store.serveAutoPrintEnabled,
      orderNoticeVoiceEnabled: store.orderNoticeVoiceEnabled,
      orderNoticeEnabled: store.orderNoticeEnabled,
    };
  }

  /** 商家端读取当前门店配置。 */
  async getForMerchant(
    user: AuthenticatedUser,
  ): Promise<ScanOrderingPickupSettings> {
    const storeId = await this.resolveMerchantStoreId(user);
    return this.getByStoreId(storeId);
  }

  /** 商家端更新当前门店配置（支持部分更新：只更新传入的字段）。 */
  async updateForMerchant(
    user: AuthenticatedUser,
    updates: Partial<ScanOrderingPickupSettings>,
  ): Promise<ScanOrderingPickupSettings> {
    const storeId = await this.resolveMerchantStoreId(user);
    await this.prisma.store.update({
      where: { id: storeId },
      data: updates,
    });
    const settings = await this.fetchByStoreId(storeId);
    await this.writeThrough(storeId, settings);
    this.logUpdate(storeId, updates);
    return settings;
  }

  /** 写穿透：配置变更后立即覆盖缓存，不留下失效窗口。 */
  private async writeThrough(
    storeId: number,
    settings: ScanOrderingPickupSettings,
  ): Promise<void> {
    try {
      await this.refreshableCache.writeRefreshableJson(
        buildPickupSettingsCacheKey(storeId),
        settings,
        PICKUP_SETTINGS_CACHE_TTL_SECONDS,
        PICKUP_SETTINGS_CACHE_REFRESH_AFTER_MS,
      );
    } catch (error) {
      // 写回失败只影响缓存新鲜度，由 TTL 兜底，不阻断配置更新
      this.logger.warn(
        `写回取餐配置缓存失败 storeId=${storeId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async resolveMerchantStoreId(
    user: AuthenticatedUser,
  ): Promise<number> {
    return this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'scan-ordering:view',
      '无权查看扫码点餐门店配置',
    );
  }

  private logUpdate(
    storeId: number,
    updates: Partial<ScanOrderingPickupSettings>,
  ): void {
    // 配置变更日志；不依赖额外 logger，避免新增基础设施
    console.info(
      `[pickup-settings] storeId=${storeId} updates=${JSON.stringify(updates)} pid=${process.pid}`,
    );
  }
}
