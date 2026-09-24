// 空间二维码海报配置服务，负责门店级配置读取、规范化与增量持久化。
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import {
  normalizeTableQrPosterConfig,
  type TableQrPosterConfig,
  type TableQrPosterConfigUpdate,
} from '../../stores/qr-poster-config.utils';

/** 空间二维码海报默认配置。 */
export const DEFAULT_SPACE_QR_POSTER_CONFIG: TableQrPosterConfig = {
  theme: 'lime',
  slogan: '自助点单 · 一扫即点',
  showStoreLogo: true,
};

/** 空间二维码海报配置服务。 */
@Injectable()
export class SpaceQrPosterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
  ) {}

  /** 读取当前登录账号所属门店的空间二维码海报配置。 */
  async getForMerchant(user: AuthenticatedUser): Promise<TableQrPosterConfig> {
    const storeId = await this.resolveMerchantStoreId(
      user,
      'space:view',
      '无权查看空间二维码海报配置',
    );
    return this.getByStoreId(storeId);
  }

  /** 增量更新当前登录账号所属门店的空间二维码海报配置。 */
  async updateForMerchant(
    user: AuthenticatedUser,
    updates: TableQrPosterConfigUpdate,
  ): Promise<TableQrPosterConfig> {
    const storeId = await this.resolveMerchantStoreId(
      user,
      'space:update',
      '无权修改空间二维码海报配置',
    );
    const current = await this.getByStoreId(storeId);
    const merged = normalizeTableQrPosterConfig(
      { ...current, ...updates },
      DEFAULT_SPACE_QR_POSTER_CONFIG,
    );
    await this.prisma.store.update({
      where: { id: storeId },
      data: {
        spaceQrPosterConfig: merged as unknown as Prisma.InputJsonValue,
      },
    });
    return merged;
  }

  /** 按门店 ID 读取配置，缺失或脏数据回退空间码默认值。 */
  private async getByStoreId(storeId: number): Promise<TableQrPosterConfig> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { spaceQrPosterConfig: true },
    });
    if (!store) throw new NotFoundException('门店不存在');
    return normalizeTableQrPosterConfig(
      store.spaceQrPosterConfig,
      DEFAULT_SPACE_QR_POSTER_CONFIG,
    );
  }

  /** 解析当前账号唯一可访问门店，并在无权限时返回业务化提示。 */
  private resolveMerchantStoreId(
    user: AuthenticatedUser,
    permission: Parameters<CommerceAccessService['resolveSingleStoreId']>[2],
    deniedMessage: string,
  ): Promise<number> {
    return this.commerceAccessService.resolveSingleStoreId(
      user,
      undefined,
      permission,
      deniedMessage,
    );
  }
}
