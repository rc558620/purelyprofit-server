import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { CommerceAccessService } from '../../commerce/commerce-access.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import {
  DEFAULT_TABLE_QR_POSTER_CONFIG,
  normalizeTableQrPosterConfig,
  ScanOrderingTableQrPosterService,
  TABLE_QR_POSTER_SLOGAN_MAX_LENGTH,
} from './scan-ordering-table-qr-poster.service';

describe('normalizeTableQrPosterConfig', () => {
  it('空值回退默认配置', () => {
    expect(normalizeTableQrPosterConfig(null)).toEqual(
      DEFAULT_TABLE_QR_POSTER_CONFIG,
    );
    expect(normalizeTableQrPosterConfig(undefined)).toEqual(
      DEFAULT_TABLE_QR_POSTER_CONFIG,
    );
    expect(normalizeTableQrPosterConfig('lime')).toEqual(
      DEFAULT_TABLE_QR_POSTER_CONFIG,
    );
  });

  it('保留合法字段', () => {
    expect(
      normalizeTableQrPosterConfig({
        theme: 'ink',
        slogan: '扫码下单',
        showStoreLogo: false,
      }),
    ).toEqual({ theme: 'ink', slogan: '扫码下单', showStoreLogo: false });
  });

  it('非法主题回退默认主题，其余合法字段保留', () => {
    expect(
      normalizeTableQrPosterConfig({ theme: 'neon', showStoreLogo: false }),
    ).toEqual({
      theme: DEFAULT_TABLE_QR_POSTER_CONFIG.theme,
      slogan: DEFAULT_TABLE_QR_POSTER_CONFIG.slogan,
      showStoreLogo: false,
    });
  });

  it('空标语回退默认标语；超长标语按上限截断', () => {
    expect(normalizeTableQrPosterConfig({ slogan: '   ' }).slogan).toBe(
      DEFAULT_TABLE_QR_POSTER_CONFIG.slogan,
    );
    const longSlogan = '扫'.repeat(TABLE_QR_POSTER_SLOGAN_MAX_LENGTH + 10);
    expect(
      normalizeTableQrPosterConfig({ slogan: longSlogan }).slogan,
    ).toHaveLength(TABLE_QR_POSTER_SLOGAN_MAX_LENGTH);
  });

  it('非布尔 showStoreLogo 回退默认值', () => {
    expect(
      normalizeTableQrPosterConfig({ showStoreLogo: 'yes' }).showStoreLogo,
    ).toBe(DEFAULT_TABLE_QR_POSTER_CONFIG.showStoreLogo);
  });
});

describe('ScanOrderingTableQrPosterService', () => {
  const user = { id: 1 } as AuthenticatedUser;

  const buildService = (
    storeRecord: { tableQrPosterConfig?: unknown } | null,
  ) => {
    const update = jest.fn().mockResolvedValue({ id: 7 });
    const prisma = {
      store: {
        findUnique: jest.fn().mockResolvedValue(storeRecord),
        update,
      },
    } as unknown as PrismaService;
    const commerceAccessService = {
      resolveSingleStoreId: jest.fn().mockResolvedValue(7),
    } as unknown as CommerceAccessService;
    return {
      service: new ScanOrderingTableQrPosterService(
        prisma,
        commerceAccessService,
      ),
      update,
    };
  };

  it('门店不存在时抛出 404', async () => {
    const { service } = buildService(null);
    await expect(service.getForMerchant(user)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('未配置时读取返回默认主题', async () => {
    const { service } = buildService({ tableQrPosterConfig: null });
    await expect(service.getForMerchant(user)).resolves.toEqual(
      DEFAULT_TABLE_QR_POSTER_CONFIG,
    );
  });

  it('更新为增量合并：未传字段保留服务端现值', async () => {
    const { service, update } = buildService({
      tableQrPosterConfig: {
        theme: 'forest',
        slogan: '扫码下单',
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
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('更新时非法主题被规范化为默认主题', async () => {
    const { service } = buildService({ tableQrPosterConfig: null });
    await expect(
      service.updateForMerchant(user, {
        theme: 'neon' as unknown as 'lime',
      }),
    ).resolves.toMatchObject({ theme: DEFAULT_TABLE_QR_POSTER_CONFIG.theme });
  });
});
