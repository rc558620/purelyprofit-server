import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';

/** 空间管理语音播报门店配置。 */
export interface SpaceManagementVoiceSettings {
  /** 空间管理语音播报开关（商家端控制，默认关闭）。 */
  spaceManagementVoiceEnabled: boolean;
}

/**
 * 空间管理语音播报门店配置服务。
 *
 * 事实源为后端 stores.space_management_voice_enabled，purelyProfit 商家端读写，
 * 前端全局通知 Provider 据此决定收到自助下单新订单时是否播报语音。
 * 权限与空间管理页对齐（space:view）：任何可进入空间管理的账号均可读写。
 */
@Injectable()
export class SpaceManagementVoiceSettingsService {
  private readonly logger = new Logger(SpaceManagementVoiceSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
  ) {}

  /** 按门店 ID 读取配置。 */
  async getByStoreId(storeId: number): Promise<SpaceManagementVoiceSettings> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { spaceManagementVoiceEnabled: true },
    });
    if (!store) throw new NotFoundException('门店不存在');
    return {
      spaceManagementVoiceEnabled: store.spaceManagementVoiceEnabled,
    };
  }

  /** 商家端读取当前门店配置。 */
  async getForMerchant(
    user: AuthenticatedUser,
  ): Promise<SpaceManagementVoiceSettings> {
    const storeId = await this.resolveMerchantStoreId(user);
    return this.getByStoreId(storeId);
  }

  /** 商家端更新当前门店配置（支持部分更新：只更新传入的字段）。 */
  async updateForMerchant(
    user: AuthenticatedUser,
    updates: Partial<SpaceManagementVoiceSettings>,
  ): Promise<SpaceManagementVoiceSettings> {
    const storeId = await this.resolveMerchantStoreId(user);
    await this.prisma.store.update({
      where: { id: storeId },
      data: updates,
    });
    this.logger.log(
      `[space-management-voice] storeId=${storeId} updates=${JSON.stringify(updates)} pid=${process.pid}`,
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
      '无权查看空间管理门店配置',
    );
  }
}
