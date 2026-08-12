// 团购券新订单语音播报门店配置服务：商家端读写 stores.voucher_order_voice_enabled（服务端为最终事实源）
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';

/** 团购券新订单语音播报门店配置。 */
export interface VoucherOrderVoiceSettings {
  /** 新订单语音播报开关（商家端控制，默认关闭）。 */
  voucherOrderVoiceEnabled: boolean;
}

/**
 * 团购券新订单语音播报配置服务。
 *
 * 事实源为后端 stores.voucher_order_voice_enabled，purelyProfit 商家端读写，
 * 前端全局通知 Provider 据此决定收到新订单时是否播报语音。
 */
@Injectable()
export class VoucherOrderVoiceSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
  ) {}

  /** 按门店 ID 读取配置。 */
  async getByStoreId(storeId: number): Promise<VoucherOrderVoiceSettings> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { voucherOrderVoiceEnabled: true },
    });
    if (!store) throw new NotFoundException('门店不存在');
    return {
      voucherOrderVoiceEnabled: store.voucherOrderVoiceEnabled,
    };
  }

  /** 商家端读取当前门店配置。 */
  async getForMerchant(
    user: AuthenticatedUser,
  ): Promise<VoucherOrderVoiceSettings> {
    const storeId = await this.resolveMerchantStoreId(user);
    return this.getByStoreId(storeId);
  }

  /** 商家端更新当前门店配置（支持部分更新：只更新传入的字段）。 */
  async updateForMerchant(
    user: AuthenticatedUser,
    updates: Partial<VoucherOrderVoiceSettings>,
  ): Promise<VoucherOrderVoiceSettings> {
    const storeId = await this.resolveMerchantStoreId(user);
    await this.prisma.store.update({
      where: { id: storeId },
      data: updates,
    });
    console.info(
      `[voucher-order-voice] storeId=${storeId} updates=${JSON.stringify(updates)} pid=${process.pid}`,
    );
    return this.getByStoreId(storeId);
  }

  private async resolveMerchantStoreId(
    user: AuthenticatedUser,
  ): Promise<number> {
    return this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'space:view',
      '无权查看团购券订单门店配置',
    );
  }
}
