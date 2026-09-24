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

export {
  DEFAULT_TABLE_QR_POSTER_CONFIG,
  normalizeTableQrPosterConfig,
  TABLE_QR_POSTER_SLOGAN_MAX_LENGTH,
  TABLE_QR_POSTER_THEMES,
  type TableQrPosterConfig,
  type TableQrPosterConfigUpdate,
  type TableQrPosterTheme,
} from '../../stores/qr-poster-config.utils';

/**
 * 扫码点餐桌码海报配置服务。
 *
 * 事实源为 stores.table_qr_poster_config JSONB，商家端桌码弹窗读写；
 * 读路径统一走 normalizeTableQrPosterConfig，保证脏数据不影响海报渲染。
 */
@Injectable()
export class ScanOrderingTableQrPosterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
  ) {}

  /** 商家端读取当前门店桌码海报配置。 */
  async getForMerchant(user: AuthenticatedUser): Promise<TableQrPosterConfig> {
    const storeId = await this.resolveMerchantStoreId(
      user,
      'scan-ordering:view',
      '无权查看扫码点餐桌码配置',
    );
    return this.getByStoreId(storeId);
  }

  /** 商家端增量更新当前门店桌码海报配置（只更新传入字段）。 */
  async updateForMerchant(
    user: AuthenticatedUser,
    updates: TableQrPosterConfigUpdate,
  ): Promise<TableQrPosterConfig> {
    const storeId = await this.resolveMerchantStoreId(
      user,
      'scan-ordering:table-manage',
      '无权修改扫码点餐桌码配置',
    );
    const current = await this.getByStoreId(storeId);
    const merged = normalizeTableQrPosterConfig({ ...current, ...updates });
    await this.prisma.store.update({
      where: { id: storeId },
      data: {
        tableQrPosterConfig: merged as unknown as Prisma.InputJsonValue,
      },
    });
    return merged;
  }

  /** 按门店 ID 读取配置（未配置 / 脏数据回退默认主题）。 */
  private async getByStoreId(storeId: number): Promise<TableQrPosterConfig> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { tableQrPosterConfig: true },
    });
    if (!store) throw new NotFoundException('门店不存在');
    return normalizeTableQrPosterConfig(store.tableQrPosterConfig);
  }

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
