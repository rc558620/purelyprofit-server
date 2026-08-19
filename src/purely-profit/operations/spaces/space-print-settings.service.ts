import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';

/** 空间小票打印通道：浏览器系统打印 / 飞鹅云打印 / 服务器本地 USB 打印 / 关闭。 */
export type SpacePrintChannel = 'browser' | 'cloud' | 'usb' | 'off';

/** 空间消费小票打印配置（独立于扫码点餐的 cashier/kitchen 通道，互不干扰）。 */
export interface SpacePrintSettings {
  /** 空间消费小票打印通道。 */
  spacePrintChannel: SpacePrintChannel;
  /** 空间消费小票飞鹅云打印机 SN（spacePrintChannel=cloud 时必填）。 */
  spaceCloudPrinterSn: string | null;
  /** 空间消费小票 USB 小票打印机标识（spacePrintChannel=usb 时使用；Linux 设备路径如 /dev/usb/lp0 或 CUPS 打印机名，留空自动探测）。 */
  spaceUsbPrinter: string | null;
}

/** 空间小票打印配置部分更新入参（PATCH 语义，只更新传入字段）。 */
export interface SpacePrintSettingsUpdate {
  spacePrintChannel?: SpacePrintChannel;
  spaceCloudPrinterSn?: string | null;
  spaceUsbPrinter?: string | null;
}

/**
 * 空间消费小票打印配置服务。
 * 事实源为后端 stores 的 spacePrint* 字段（general 业态门店），
 * 与扫码点餐打印配置（cashier/kitchen 字段）物理隔离，互不污染。
 */
@Injectable()
export class SpacePrintSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
  ) {}

  /** 按门店 ID 读取空间小票打印配置。 */
  async getByStoreId(storeId: number): Promise<SpacePrintSettings> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: {
        spacePrintChannel: true,
        spaceCloudPrinterSn: true,
        spaceUsbPrinter: true,
      },
    });
    if (!store) throw new NotFoundException('门店不存在');
    return {
      spacePrintChannel: store.spacePrintChannel as SpacePrintChannel,
      spaceCloudPrinterSn: store.spaceCloudPrinterSn,
      spaceUsbPrinter: store.spaceUsbPrinter,
    };
  }

  /** 商家端读取当前门店空间小票打印配置。 */
  async getForMerchant(user: AuthenticatedUser): Promise<SpacePrintSettings> {
    const storeId = await this.resolveMerchantStoreId(user);
    return this.getByStoreId(storeId);
  }

  /** 商家端更新当前门店空间小票打印配置（支持部分更新）。 */
  async updateForMerchant(
    user: AuthenticatedUser,
    updates: SpacePrintSettingsUpdate,
  ): Promise<SpacePrintSettings> {
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
      'space:view',
      '无权查看空间小票打印配置',
    );
  }

  private logUpdate(
    storeId: number,
    updates: SpacePrintSettingsUpdate,
  ): void {
    // 配置变更日志；与扫码点餐打印配置同风格，便于排查
    console.info(
      `[space-print-settings] storeId=${storeId} updates=${JSON.stringify(updates)} pid=${process.pid}`,
    );
  }
}
