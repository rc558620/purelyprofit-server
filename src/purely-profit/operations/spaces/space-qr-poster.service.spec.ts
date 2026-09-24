// 空间二维码海报配置服务单元测试。
import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { CommerceAccessService } from '../../commerce/commerce-access.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { TABLE_QR_POSTER_SLOGAN_MAX_LENGTH } from '../../stores/qr-poster-config.utils';
import {
  DEFAULT_SPACE_QR_POSTER_CONFIG,
  SpaceQrPosterService,
} from './space-qr-poster.service';

describe('SpaceQrPosterService', () => {
  const user = { id: 1 } as AuthenticatedUser;

  const buildService = (
    storeRecord: { spaceQrPosterConfig?: unknown } | null,
  ) => {
    const update = jest.fn().mockResolvedValue({ id: 7 });
    const resolveSingleStoreId = jest.fn().mockResolvedValue(7);
    const prisma = {
      store: {
        findUnique: jest.fn().mockResolvedValue(storeRecord),
        update,
      },
    } as unknown as PrismaService;
    const commerceAccessService = {
      resolveSingleStoreId,
    } as unknown as CommerceAccessService;
    return {
      service: new SpaceQrPosterService(prisma, commerceAccessService),
      update,
      resolveSingleStoreId,
    };
  };

  it('门店不存在时抛出 404', async () => {
    const { service } = buildService(null);
    await expect(service.getForMerchant(user)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('未配置时读取空间码默认值', async () => {
    const { service, resolveSingleStoreId } = buildService({
      spaceQrPosterConfig: null,
    });
    await expect(service.getForMerchant(user)).resolves.toEqual(
      DEFAULT_SPACE_QR_POSTER_CONFIG,
    );
    expect(resolveSingleStoreId).toHaveBeenCalledWith(
      user,
      undefined,
      'space:view',
      '无权查看空间二维码海报配置',
    );
  });

  it('非法主题回退空间码默认主题', async () => {
    const { service } = buildService({
      spaceQrPosterConfig: { theme: 'neon' },
    });
    await expect(service.getForMerchant(user)).resolves.toMatchObject({
      theme: DEFAULT_SPACE_QR_POSTER_CONFIG.theme,
      slogan: DEFAULT_SPACE_QR_POSTER_CONFIG.slogan,
    });
  });

  it('超长标语按统一上限截断', async () => {
    const { service } = buildService({
      spaceQrPosterConfig: {
        slogan: '扫'.repeat(TABLE_QR_POSTER_SLOGAN_MAX_LENGTH + 10),
      },
    });
    const config = await service.getForMerchant(user);
    expect(config.slogan).toHaveLength(TABLE_QR_POSTER_SLOGAN_MAX_LENGTH);
  });

  it('增量更新时保留未传入字段并写入独立配置列', async () => {
    const { service, update, resolveSingleStoreId } = buildService({
      spaceQrPosterConfig: {
        theme: 'forest',
        slogan: '扫码使用',
        showStoreLogo: true,
      },
    });
    await expect(
      service.updateForMerchant(user, { slogan: '欢迎光临' }),
    ).resolves.toEqual({
      theme: 'forest',
      slogan: '欢迎光临',
      showStoreLogo: true,
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: {
        spaceQrPosterConfig: {
          theme: 'forest',
          slogan: '欢迎光临',
          showStoreLogo: true,
        },
      },
    });
    expect(resolveSingleStoreId).toHaveBeenLastCalledWith(
      user,
      undefined,
      'space:update',
      '无权修改空间二维码海报配置',
    );
  });
});
