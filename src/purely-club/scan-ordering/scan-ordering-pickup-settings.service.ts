import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CommerceAccessService } from '../../purely-profit/commerce/commerce-access.service';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';

/** 扫码点餐取餐相关门店配置。 */
export interface ScanOrderingPickupSettings {
  /** 语音播报开关（商家端控制，顾客端据此展示取餐通知弹窗）。 */
  pickupVoiceEnabled: boolean;
  /** 出餐自动打印开关（商家端控制，开启后点击出餐自动唤起小票打印）。 */
  serveAutoPrintEnabled: boolean;
}

/**
 * 扫码点餐取餐相关门店配置服务。
 *
 * 事实源为后端 stores.pickup_voice_enabled，purelyProfit 商家端读写，
 * purelyClub 顾客端只读；不允许 purelyClub 自行猜测商家开关状态。
 */
@Injectable()
export class ScanOrderingPickupSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
  ) {}

  /** 按门店 ID 读取配置（顾客端使用）。 */
  async getByStoreId(storeId: number): Promise<ScanOrderingPickupSettings> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { pickupVoiceEnabled: true, serveAutoPrintEnabled: true },
    });
    if (!store) throw new NotFoundException('门店不存在');
    return {
      pickupVoiceEnabled: store.pickupVoiceEnabled,
      serveAutoPrintEnabled: store.serveAutoPrintEnabled,
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
    this.logUpdate(storeId, updates);
    return this.getByStoreId(storeId);
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

  private logUpdate(storeId: number, updates: Partial<ScanOrderingPickupSettings>): void {
    // 配置变更日志；不依赖额外 logger，避免新增基础设施
    console.info(
      `[pickup-settings] storeId=${storeId} updates=${JSON.stringify(updates)} pid=${process.pid}`,
    );
  }
}
