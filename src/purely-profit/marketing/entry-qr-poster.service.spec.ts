// 进店二维码海报配置服务单元测试。
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { TABLE_QR_POSTER_SLOGAN_MAX_LENGTH } from '../stores/qr-poster-config.utils';
import type { MarketingSharedService } from './marketing-shared.service';
import {
  DEFAULT_ENTRY_QR_POSTER_CONFIG,
  EntryQrPosterService,
} from './entry-qr-poster.service';

describe('EntryQrPosterService', () => {
  const user = { id: 1 } as AuthenticatedUser;

  const buildService = (
    storeRecord: { entryQrPosterConfig?: unknown } | null,
    resolvedStoreId: number | null = 7,
  ) => {
    const update = jest.fn().mockResolvedValue({ id: 7 });
    const prisma = {
      store: {
        findUnique: jest.fn().mockResolvedValue(storeRecord),
        update,
      },
    } as unknown as PrismaService;
    const resolveMembershipManagedStoreId = jest
      .fn()
      .mockResolvedValue(resolvedStoreId);
    const ensureMarketingStoreAccess = jest.fn().mockResolvedValue(undefined);
    const marketingSharedService = {
      resolveMembershipManagedStoreId,
      ensureMarketingStoreAccess,
    } as unknown as MarketingSharedService;
    return {
      service: new EntryQrPosterService(prisma, marketingSharedService),
      update,
      resolveMembershipManagedStoreId,
      ensureMarketingStoreAccess,
    };
  };

  it('门店不存在时抛出 404', async () => {
    const { service } = buildService(null);
    await expect(service.getForMerchant(user)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('无营销查看权限时读取抛出 403', async () => {
    const { service } = buildService({ entryQrPosterConfig: null }, null);
    await expect(service.getForMerchant(user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('未配置时读取进店码默认值', async () => {
    const { service, resolveMembershipManagedStoreId } = buildService({
      entryQrPosterConfig: null,
    });
    await expect(service.getForMerchant(user)).resolves.toEqual(
      DEFAULT_ENTRY_QR_POSTER_CONFIG,
    );
    expect(resolveMembershipManagedStoreId).toHaveBeenCalledWith(
      user,
      undefined,
    );
  });

  it('非法主题回退进店码默认主题', async () => {
    const { service } = buildService({
      entryQrPosterConfig: { theme: 'neon' },
    });
    await expect(service.getForMerchant(user)).resolves.toMatchObject({
      theme: DEFAULT_ENTRY_QR_POSTER_CONFIG.theme,
      slogan: DEFAULT_ENTRY_QR_POSTER_CONFIG.slogan,
    });
  });

  it('超长标语按统一上限截断', async () => {
    const { service } = buildService({
      entryQrPosterConfig: {
        slogan: '扫'.repeat(TABLE_QR_POSTER_SLOGAN_MAX_LENGTH + 10),
      },
    });
    const config = await service.getForMerchant(user);
    expect(config.slogan).toHaveLength(TABLE_QR_POSTER_SLOGAN_MAX_LENGTH);
  });

  it('增量更新时保留未传入字段并写入独立配置列', async () => {
    const { service, update, ensureMarketingStoreAccess } = buildService({
      entryQrPosterConfig: {
        theme: 'forest',
        slogan: '扫码进店',
        showStoreLogo: true,
      },
    });
    await expect(
      service.updateForMerchant(user, undefined, { slogan: '欢迎光临' }),
    ).resolves.toEqual({
      theme: 'forest',
      slogan: '欢迎光临',
      showStoreLogo: true,
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: {
        entryQrPosterConfig: {
          theme: 'forest',
          slogan: '欢迎光临',
          showStoreLogo: true,
        },
      },
    });
    expect(ensureMarketingStoreAccess).toHaveBeenCalledWith(
      user,
      7,
      'marketing:manage',
    );
  });

  it('无营销查看权限时更新抛出 403 且不落库', async () => {
    const { service, update } = buildService(
      { entryQrPosterConfig: null },
      null,
    );
    await expect(
      service.updateForMerchant(user, undefined, { slogan: '欢迎光临' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
  });
});
