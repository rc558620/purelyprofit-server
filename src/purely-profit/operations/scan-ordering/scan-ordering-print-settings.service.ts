import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { buildCacheRefreshTaskKey } from '../../../redis/cache-keys';
import { RefreshableCacheService } from '../../../redis/refreshable-cache.service';

/** 打印通道：浏览器系统打印 / 飞鹅云打印 / 服务器本地 USB 打印 / 关闭。 */
export type PrintChannel = 'browser' | 'cloud' | 'usb' | 'off';

/** 扫码点餐打印配置（收银台顾客票 + 后厨制作单，各自独立通道）。 */
export interface ScanOrderingPrintSettings {
  /** 收银台顾客票打印通道。 */
  cashierPrintChannel: PrintChannel;
  /** 后厨制作单打印通道。 */
  kitchenPrintChannel: PrintChannel;
  /** 收银台飞鹅云打印机 SN（cashierPrintChannel=cloud 时必填）。 */
  cashierCloudPrinterSn: string | null;
  /** 后厨飞鹅云打印机 SN（kitchenPrintChannel=cloud 时必填）。 */
  kitchenCloudPrinterSn: string | null;
  /** 收银台 USB 小票打印机标识（cashierPrintChannel=usb 时使用；Linux 设备路径如 /dev/usb/lp0 或 CUPS 打印机名，留空自动探测）。 */
  cashierUsbPrinter: string | null;
  /** 后厨 USB 小票打印机标识（kitchenPrintChannel=usb 时使用）。 */
  kitchenUsbPrinter: string | null;
}

/** 打印配置部分更新入参（PATCH 语义，只更新传入字段）。 */
export interface ScanOrderingPrintSettingsUpdate {
  cashierPrintChannel?: PrintChannel;
  kitchenPrintChannel?: PrintChannel;
  cashierCloudPrinterSn?: string | null;
  kitchenCloudPrinterSn?: string | null;
  cashierUsbPrinter?: string | null;
  kitchenUsbPrinter?: string | null;
}

/**
 * 门店打印配置读缓存：打印链路与设置页会反复读同一份配置。
 *
 * 复用 RefreshableCacheService 的 singleflight / TTL 抖动 / 后台刷新，
 * 写路径写穿透立即覆盖；Redis 异常时降级查库，缓存不是唯一数据源。
 */
const PRINT_SETTINGS_CACHE_TTL_SECONDS = 30;
const PRINT_SETTINGS_CACHE_REFRESH_AFTER_MS = 10_000;

function buildPrintSettingsCacheKey(storeId: number): string {
  return `scanordering:print-settings:store:${storeId}`;
}

/**
 * 扫码点餐打印配置服务。
 * 事实源为后端 stores 的打印通道字段，purelyProfit 商家端读写，
 * 供浏览器打印通道与飞鹅云打印通道共用。
 */
@Injectable()
export class ScanOrderingPrintSettingsService {
  private readonly logger = new Logger(ScanOrderingPrintSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly refreshableCache: RefreshableCacheService,
  ) {}

  /** 按门店 ID 读取打印配置。 */
  async getByStoreId(storeId: number): Promise<ScanOrderingPrintSettings> {
    const cacheKey = buildPrintSettingsCacheKey(storeId);
    try {
      return await this.refreshableCache.getOrLoadRefreshableJson<ScanOrderingPrintSettings>(
        {
          cacheKey,
          taskKey: buildCacheRefreshTaskKey(cacheKey),
          ttlSeconds: PRINT_SETTINGS_CACHE_TTL_SECONDS,
          refreshAfterMs: PRINT_SETTINGS_CACHE_REFRESH_AFTER_MS,
          loadValue: () => this.fetchByStoreId(storeId),
        },
      );
    } catch (error) {
      // 业务异常不能被缓存降级吞掉；其余异常按缓存不可用处理，回退查库
      if (error instanceof NotFoundException) throw error;
      this.logger.warn(
        `读取打印配置缓存失败 storeId=${storeId}，回退查库: ${error instanceof Error ? error.message : String(error)}`,
      );
      return this.fetchByStoreId(storeId);
    }
  }

  /** 配置事实源：缓存回源与写穿透共用同一份字段口径。 */
  private async fetchByStoreId(
    storeId: number,
  ): Promise<ScanOrderingPrintSettings> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: {
        cashierPrintChannel: true,
        kitchenPrintChannel: true,
        cashierCloudPrinterSn: true,
        kitchenCloudPrinterSn: true,
        cashierUsbPrinter: true,
        kitchenUsbPrinter: true,
      },
    });
    if (!store) throw new NotFoundException('门店不存在');
    return {
      cashierPrintChannel: store.cashierPrintChannel as PrintChannel,
      kitchenPrintChannel: store.kitchenPrintChannel as PrintChannel,
      cashierCloudPrinterSn: store.cashierCloudPrinterSn,
      kitchenCloudPrinterSn: store.kitchenCloudPrinterSn,
      cashierUsbPrinter: store.cashierUsbPrinter,
      kitchenUsbPrinter: store.kitchenUsbPrinter,
    };
  }

  /** 商家端读取当前门店打印配置。 */
  async getForMerchant(
    user: AuthenticatedUser,
  ): Promise<ScanOrderingPrintSettings> {
    const storeId = await this.resolveMerchantStoreId(user);
    return this.getByStoreId(storeId);
  }

  /** 商家端更新当前门店打印配置（支持部分更新）。 */
  async updateForMerchant(
    user: AuthenticatedUser,
    updates: ScanOrderingPrintSettingsUpdate,
  ): Promise<ScanOrderingPrintSettings> {
    const storeId = await this.resolveMerchantStoreId(user);
    // DTO 全字段可选：空更新会让 Prisma 抛校验错误（表现为 500），这里提前转成 400。
    // （请求体经全局 ValidationPipe 的 whitelist 处理后，未传字段会被剥离。）
    if (Object.keys(updates).length === 0) {
      throw new BadRequestException('没有需要更新的打印配置字段');
    }
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
    settings: ScanOrderingPrintSettings,
  ): Promise<void> {
    try {
      await this.refreshableCache.writeRefreshableJson(
        buildPrintSettingsCacheKey(storeId),
        settings,
        PRINT_SETTINGS_CACHE_TTL_SECONDS,
        PRINT_SETTINGS_CACHE_REFRESH_AFTER_MS,
      );
    } catch (error) {
      // 写回失败只影响缓存新鲜度，由 TTL 兜底，不阻断配置更新
      this.logger.warn(
        `写回打印配置缓存失败 storeId=${storeId}: ${error instanceof Error ? error.message : String(error)}`,
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
      '无权查看扫码点餐打印配置',
    );
  }

  private logUpdate(
    storeId: number,
    updates: ScanOrderingPrintSettingsUpdate,
  ): void {
    // 配置变更日志；不依赖额外 logger，避免新增基础设施
    console.info(
      `[print-settings] storeId=${storeId} updates=${JSON.stringify(updates)} pid=${process.pid}`,
    );
  }
}
