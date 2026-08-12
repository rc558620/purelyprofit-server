import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';

/** 服务呼叫语音播报门店配置。 */
export interface ServiceCallVoiceSettings {
  /** 服务呼叫语音播报开关（商家端控制，默认关闭）。 */
  serviceCallVoiceEnabled: boolean;
}

/**
 * 服务呼叫语音播报门店配置服务。
 *
 * 事实源为后端 stores.service_call_voice_enabled，purelyProfit 商家端读写。
 * 服务呼叫面向全部门店业态（餐饮/非餐饮账号均可用），不依赖扫码点餐能力。
 */
@Injectable()
export class ServiceCallVoiceSettingsService {
  private readonly logger = new Logger(ServiceCallVoiceSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
  ) {}

  /** 按门店 ID 读取配置。 */
  async getByStoreId(storeId: number): Promise<ServiceCallVoiceSettings> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { serviceCallVoiceEnabled: true },
    });
    if (!store) throw new NotFoundException('门店不存在');
    return {
      serviceCallVoiceEnabled: store.serviceCallVoiceEnabled,
    };
  }

  /** 商家端读取当前门店配置。 */
  async getForMerchant(
    user: AuthenticatedUser,
  ): Promise<ServiceCallVoiceSettings> {
    const storeId = await this.resolveMerchantStoreId(user);
    return this.getByStoreId(storeId);
  }

  /** 商家端更新当前门店配置（支持部分更新：只更新传入的字段）。 */
  async updateForMerchant(
    user: AuthenticatedUser,
    updates: Partial<ServiceCallVoiceSettings>,
  ): Promise<ServiceCallVoiceSettings> {
    const storeId = await this.resolveMerchantStoreId(user);
    await this.prisma.store.update({
      where: { id: storeId },
      data: updates,
    });
    this.logger.log(
      `[service-call-voice] storeId=${storeId} updates=${JSON.stringify(updates)} pid=${process.pid}`,
    );
    return this.getByStoreId(storeId);
  }

  private async resolveMerchantStoreId(
    user: AuthenticatedUser,
  ): Promise<number> {
    return this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      'service-call:view',
      '无权查看服务呼叫门店配置',
    );
  }
}
