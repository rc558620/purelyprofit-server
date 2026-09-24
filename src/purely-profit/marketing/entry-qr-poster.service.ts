// 进店二维码海报配置服务，负责营销中心海报配置的读取、规范化与增量持久化。
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import {
  normalizeTableQrPosterConfig,
  type TableQrPosterConfig,
  type TableQrPosterConfigUpdate,
} from '../stores/qr-poster-config.utils';
import { MarketingSharedService } from './marketing-shared.service';

/** 进店二维码海报默认配置。 */
export const DEFAULT_ENTRY_QR_POSTER_CONFIG: TableQrPosterConfig = {
  theme: 'lime',
  slogan: '扫码进店 · 加入本店',
  showStoreLogo: true,
};

/**
 * 进店二维码海报配置服务。
 *
 * 营销中心跨业态（general 门店的空间码海报、餐饮门店的桌码海报都会与进店码
 * 海报同时使用），因此配置独立落在 `stores.entry_qr_poster_config`，不复用另两列。
 */
@Injectable()
export class EntryQrPosterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly marketingSharedService: MarketingSharedService,
  ) {}

  /** 读取当前登录账号所属门店的进店二维码海报配置。 */
  async getForMerchant(
    user: AuthenticatedUser,
    storeId?: number,
  ): Promise<TableQrPosterConfig> {
    const resolvedStoreId = await this.resolveViewableStoreId(
      user,
      storeId,
      '无权查看进店二维码海报配置',
    );
    return this.getByStoreId(resolvedStoreId);
  }

  /** 增量更新当前登录账号所属门店的进店二维码海报配置。 */
  async updateForMerchant(
    user: AuthenticatedUser,
    storeId: number | undefined,
    updates: TableQrPosterConfigUpdate,
  ): Promise<TableQrPosterConfig> {
    const resolvedStoreId = await this.resolveViewableStoreId(
      user,
      storeId,
      '无权修改进店二维码海报配置',
    );
    await this.marketingSharedService.ensureMarketingStoreAccess(
      user,
      resolvedStoreId,
      'marketing:manage',
    );

    const current = await this.getByStoreId(resolvedStoreId);
    const merged = normalizeTableQrPosterConfig(
      { ...current, ...updates },
      DEFAULT_ENTRY_QR_POSTER_CONFIG,
    );
    await this.prisma.store.update({
      where: { id: resolvedStoreId },
      data: {
        entryQrPosterConfig: merged as unknown as Prisma.InputJsonValue,
      },
    });
    return merged;
  }

  /** 按门店 ID 读取配置，缺失或脏数据回退进店码默认值。 */
  private async getByStoreId(storeId: number): Promise<TableQrPosterConfig> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { entryQrPosterConfig: true },
    });
    if (!store) throw new NotFoundException('门店不存在');
    return normalizeTableQrPosterConfig(
      store.entryQrPosterConfig,
      DEFAULT_ENTRY_QR_POSTER_CONFIG,
    );
  }

  /** 解析营销域门店 ID，无 marketing:view 权限或无归属门店时抛业务化 403。 */
  private async resolveViewableStoreId(
    user: AuthenticatedUser,
    storeId: number | undefined,
    deniedMessage: string,
  ): Promise<number> {
    const resolvedStoreId =
      await this.marketingSharedService.resolveMembershipManagedStoreId(
        user,
        storeId,
      );
    if (resolvedStoreId === null) {
      throw new ForbiddenException(deniedMessage);
    }
    return resolvedStoreId;
  }
}
