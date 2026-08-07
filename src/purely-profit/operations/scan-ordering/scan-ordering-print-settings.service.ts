import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';

/** 打印通道：浏览器系统打印 / 飞鹅云打印 / 关闭。 */
export type PrintChannel = 'browser' | 'cloud' | 'off';

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
}

/** 打印配置部分更新入参（PATCH 语义，只更新传入字段）。 */
export interface ScanOrderingPrintSettingsUpdate {
  cashierPrintChannel?: PrintChannel;
  kitchenPrintChannel?: PrintChannel;
  cashierCloudPrinterSn?: string | null;
  kitchenCloudPrinterSn?: string | null;
}

/**
 * 扫码点餐打印配置服务。
 * 事实源为后端 stores 的打印通道字段，purelyProfit 商家端读写，
 * 供浏览器打印通道与飞鹅云打印通道共用。
 */
@Injectable()
export class ScanOrderingPrintSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
  ) {}

  /** 按门店 ID 读取打印配置。 */
  async getByStoreId(storeId: number): Promise<ScanOrderingPrintSettings> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: {
        cashierPrintChannel: true,
        kitchenPrintChannel: true,
        cashierCloudPrinterSn: true,
        kitchenCloudPrinterSn: true,
      },
    });
    if (!store) throw new NotFoundException('门店不存在');
    return {
      cashierPrintChannel: store.cashierPrintChannel as PrintChannel,
      kitchenPrintChannel: store.kitchenPrintChannel as PrintChannel,
      cashierCloudPrinterSn: store.cashierCloudPrinterSn,
      kitchenCloudPrinterSn: store.kitchenCloudPrinterSn,
    };
  }

  /** 商家端读取当前门店打印配置。 */
  async getForMerchant(user: AuthenticatedUser): Promise<ScanOrderingPrintSettings> {
    const storeId = await this.resolveMerchantStoreId(user);
    return this.getByStoreId(storeId);
  }

  /** 商家端更新当前门店打印配置（支持部分更新）。 */
  async updateForMerchant(
    user: AuthenticatedUser,
    updates: ScanOrderingPrintSettingsUpdate,
  ): Promise<ScanOrderingPrintSettings> {
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
      '无权查看扫码点餐打印配置',
    );
  }

  private logUpdate(storeId: number, updates: ScanOrderingPrintSettingsUpdate): void {
    // 配置变更日志；不依赖额外 logger，避免新增基础设施
    console.info(
      `[print-settings] storeId=${storeId} updates=${JSON.stringify(updates)} pid=${process.pid}`,
    );
  }
}
